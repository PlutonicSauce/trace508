import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { db } from '../../packages/core/src/db';
import { createAssessment } from '../../packages/core/src/assessment';
import { initializeLab } from '../../packages/core/src/lab';
import { deleteAssessment, createEvidencePackage } from '../../packages/core/src/provenance';
import { scanAssessment } from '../../workers/scan/scanner';
const url = new URL(process.env.DATABASE_URL!);
assert(url.pathname.endsWith('_release_test'));
const org = await db.organization.create({ data: { name: 'TEST FIXTURE actual worker faults' } });
const project = await db.project.create({
  data: { name: 'TEST FIXTURE fault isolation', organizationId: org.id, isFixture: true },
});
const sites = await initializeLab(project.id, 'TEST FIXTURE fault injector');
const target = await db.target.findFirstOrThrow({
  where: { projectId: project.id, pathPrefix: '/site/' + sites[0].id },
});
const base = target.origin + target.pathPrefix;
const log = createWriteStream('.local/release-worker-faults.log', { flags: 'a' });
let worker: ChildProcess | undefined;
const start = () => {
  worker = spawn(process.execPath, ['--import', 'tsx', 'workers/scan/index.ts'], {
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout!.pipe(log, { end: false });
  worker.stderr!.pipe(log, { end: false });
};
async function poll<T>(fn: () => Promise<T>, predicate: (x: T) => boolean, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const x = await fn();
    if (predicate(x)) return x;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Poll timed out');
}
async function stop(signal: NodeJS.Signals = 'SIGTERM') {
  if (worker && worker.exitCode === null) {
    const done = new Promise<void>((r) => worker!.once('exit', () => r()));
    const force = setTimeout(() => {
      try {
        process.kill(-worker!.pid!, 'SIGKILL');
      } catch {}
    }, 5000);
    process.kill(-worker.pid!, signal);
    await done;
    clearTimeout(force);
  }
  worker = undefined;
}
const create = (name: string, suffix = '', defer = true) =>
  createAssessment(
    { name: 'TEST FIXTURE ' + name, url: base + suffix, targetId: target.id },
    project.id,
    'TEST FIXTURE fault injector',
    undefined,
    defer,
  );
const measurements: Record<string, unknown> = { fixtureOnly: true };
try {
  const a = await create('actual process crash', '?delay=8000', false);
  start();
  await poll(
    () => db.assessment.findUniqueOrThrow({ where: { id: a.id } }),
    (x) => x.progress.startsWith('Navigating'),
  );
  await stop('SIGKILL');
  await db.assessment.update({
    where: { id: a.id },
    data: { updatedAt: new Date(Date.now() - 240000) },
  });
  await db.workerLease.updateMany({
    where: { assessmentId: a.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  start();
  const failed = await poll(
    () => db.assessment.findUniqueOrThrow({ where: { id: a.id } }),
    (x) => x.status === 'failed',
  );
  assert.notEqual(failed.status, 'completed');
  measurements.workerProcessCrash = 'failed with retained scan run';
  console.log(
    'PASS actual worker process-group SIGKILL and replacement recovery never completed interrupted scan',
  );
  const crash = await create('actual browser crash', '?delay=8000', false);
  await poll(
    () => db.assessment.findUniqueOrThrow({ where: { id: crash.id } }),
    (x) => x.progress.startsWith('Navigating'),
  );
  const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split(
    '\n',
  );
  const child = processes
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .find(
      (m) => m && Number(m[2]) === worker!.pid && /headless_shell|chrome-headless-shell/.test(m[3]),
    );
  assert(child, 'Actual Chromium child process must be observed before fault injection');
  process.kill(Number(child[1]), 'SIGKILL');
  await poll(
    () => db.assessment.findUniqueOrThrow({ where: { id: crash.id } }),
    (x) => x.status === 'failed',
  );
  measurements.browserProcessCrash = 'actual Chromium SIGKILL -> failed';
  console.log('PASS actual Chromium process crash persists failure');
  await stop();
  for (const [name, suffix, options] of [
    ['invalid redirect', '?redirect=http://127.0.0.1:55432/', {}],
    ['network timeout', '?delay=5000', { navigationTimeoutMs: 100 }],
  ] as const) {
    const f = await create(name, suffix);
    await db.assessment.update({ where: { id: f.id }, data: { status: 'running' } });
    await scanAssessment(f.id, options);
    assert.equal((await db.assessment.findUniqueOrThrow({ where: { id: f.id } })).status, 'failed');
    measurements[name] = 'failed';
    console.log('PASS ' + name + ' fails closed on controlled target');
  }
  const large = await create('500 actual repeated defects', '?repeat=500', false);
  const began = Date.now();
  start();
  await poll(
    () => db.assessment.findUniqueOrThrow({ where: { id: large.id } }),
    (x) => ['completed', 'failed'].includes(x.status),
    90000,
  );
  const record = await db.assessment.findUniqueOrThrow({
    where: { id: large.id },
    include: { findings: { include: { evidence: true } } },
  });
  assert.equal(record.status, 'completed');
  const nodes = record.findings.flatMap((f) => f.evidence).length;
  assert(nodes >= 500);
  const pkg = await createEvidencePackage(large.id, 'TEST FIXTURE large package');
  measurements.largeEvidence = {
    nodes,
    ruleFindings: record.findings.length,
    elapsedMs: Date.now() - began,
    archiveSha256: pkg.sha256,
  };
  console.log(
    'PASS actual large evidence scan and package: ' + nodes + ' observed element records',
  );
  // A real lost database connection affects this isolated database only.
  const controlURL = new URL(url);
  controlURL.pathname = '/postgres';
  const control = new PrismaClient({ datasources: { db: { url: controlURL.href } } });
  const keeper = (await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
  try {
    await control.$executeRawUnsafe('ALTER DATABASE trace508_release_test ALLOW_CONNECTIONS false');
    await control.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='trace508_release_test' AND pid<>${keeper}`;
    await new Promise((r) => setTimeout(r, 2500));
  } finally {
    await control.$executeRawUnsafe('ALTER DATABASE trace508_release_test ALLOW_CONNECTIONS true');
    await control.$disconnect();
  }
  if (worker?.exitCode !== null) start();
  const resumed = await create('after database disconnection', '', false);
  await poll(
    () => db.assessment.findUniqueOrThrow({ where: { id: resumed.id } }),
    (x) => {
      if (x.status === 'failed') throw new Error(`Resumed assessment failed: ${x.error}`);
      return x.status === 'completed';
    },
    60000,
  );
  measurements.databaseReconnection =
    'fresh queued scan completed after isolated DB connections were denied and terminated';
  console.log('PASS worker resumes after real isolated database connection loss');
  await writeFile('.local/release-fault-measurements.json', JSON.stringify(measurements, null, 2));
} finally {
  await stop();
  log.end();
  for (const a of await db.assessment.findMany({ where: { projectId: project.id } })) {
    await db.assessment.update({
      where: { id: a.id },
      data: {
        status: ['running', 'queued', 'preparing'].includes(a.status) ? 'cancelled' : a.status,
      },
    });
    await db.scanRun.updateMany({
      where: { assessmentId: a.id, status: 'running' },
      data: { status: 'failed', completedAt: new Date() },
    });
    await deleteAssessment(a.id, project.id, 'TEST FIXTURE fault cleanup');
  }
  await db.journey.deleteMany({ where: { projectId: project.id } });
  await db.target.deleteMany({ where: { projectId: project.id } });
  await db.labSite.deleteMany({ where: { projectId: project.id } });
  await db.projectEvent.deleteMany({ where: { projectId: project.id } });
  await db.project.delete({ where: { id: project.id } });
  await db.organization.delete({ where: { id: org.id } });
  await db.$disconnect();
}
