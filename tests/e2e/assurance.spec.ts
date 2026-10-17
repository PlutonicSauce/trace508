import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile, mkdir, rm, readFile, access } from 'node:fs/promises';
import { localPath } from '../../packages/core/src/storage';
import { generateReport } from '../../packages/core/src/reports';
import { createEvidencePackage } from '../../packages/core/src/provenance';
import { PrismaClient } from '@prisma/client';
import { db } from '../../packages/core/src/db';
import { passwordHash } from '../../packages/core/src/auth';
import { deleteAssessment } from '../../packages/core/src/provenance';
import { scanAssessment } from '../../workers/scan/scanner';
import { createAssessment } from '../../packages/core/src/assessment';
import { hash, evidenceHash } from '../../packages/core/src/ids';
import { openacrDocument } from '../../packages/core/src/openacr';
test.describe.configure({ mode: 'serial' });
let api: APIRequestContext,
  viewer: APIRequestContext,
  operator: APIRequestContext,
  projectId = '',
  orgId = '',
  alphaId = '',
  betaId = '',
  baselineId = '',
  cleanId = '';
const password = randomUUID() + '-Assurance-fixture',
  email = 'fixture-' + randomUUID() + '@trace508.test';
async function call(path: string, body?: unknown) {
  const r =
    body === undefined
      ? await api.get('/api/' + path)
      : await api.post('/api/' + path, { data: body });
  const d = await r.json();
  expect(r.ok(), JSON.stringify(d)).toBe(true);
  return d;
}
async function completed(id: string) {
  await expect
    .poll(
      async () => {
        const a = await call('assessments/' + id);
        if (a.status === 'failed') throw new Error(a.error);
        return a.status;
      },
      { timeout: 90000 },
    )
    .toBe('completed');
  return call('assessments/' + id);
}
async function login(role: string) {
  const memberEmail = role === 'admin' ? email : role + '-' + email;
  if (role !== 'admin')
    await db.user.create({
      data: {
        email: memberEmail,
        name: 'TEST FIXTURE ' + role,
        organizationId: orgId,
        role,
        passwordHash: await passwordHash(password),
      },
    });
  const c = await requestFactory.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000',
    extraHTTPHeaders: { Origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000' },
  });
  expect(
    (await c.post('/api/auth/login', { data: { email: memberEmail, password } })).status(),
  ).toBe(200);
  return c;
}
test.beforeAll(async () => {
  expect(
    new URL(process.env.DATABASE_URL!).pathname.endsWith('_release_test'),
    'Acceptance tests require an isolated _release_test database',
  ).toBe(true);
  const org = await db.organization.create({
    data: { name: 'ISOLATED AUTOMATED ACCEPTANCE FIXTURE' },
  });
  orgId = org.id;
  const project = await db.project.create({
    data: {
      organizationId: orgId,
      name: 'ISOLATED TEST FIXTURE · assurance verification',
      isFixture: true,
      targets: {
        create: {
          name: 'W3C test scope',
          origin: 'https://www.w3.org',
          pathPrefix: '/WAI/demos/bad',
        },
      },
    },
  });
  projectId = project.id;
  await db.user.create({
    data: {
      organizationId: orgId,
      email,
      name: 'TEST FIXTURE reviewer action',
      role: 'admin',
      passwordHash: await passwordHash(password),
    },
  });
  api = await login('admin');
  viewer = await login('viewer');
  operator = await login('operator');
  const sites = await call('lab', {});
  alphaId = sites[0].id;
  betaId = sites[1].id;
});
test.afterAll(async () => {
  if (projectId) {
    const all = await db.assessment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    for (const a of all) {
      if (['queued', 'running', 'preparing'].includes(a.status)) {
        await db.assessment.update({ where: { id: a.id }, data: { status: 'cancelled' } });
        await new Promise((r) => setTimeout(r, 1800));
      }
      await deleteAssessment(a.id, projectId, 'test-fixture-cleanup');
    }
    await db.journey.deleteMany({ where: { projectId } });
    await db.target.deleteMany({ where: { projectId } });
    await db.labSite.deleteMany({ where: { projectId } });
    await db.projectEvent.deleteMany({ where: { projectId } });
    await db.accountToken.deleteMany({ where: { organizationId: orgId } });
    await db.user.deleteMany({ where: { organizationId: orgId } });
    await db.project.delete({ where: { id: projectId } });
    await db.organization.delete({ where: { id: orgId } });
  }
  await api?.dispose();
  await viewer?.dispose();
  await operator?.dispose();
  await db.$disconnect();
});
test('real two-site assessment, change, independent retest, reviewer gate, regression and living exports', async ({
  page,
}) => {
  const workspace = await call('workspace'),
    ta = workspace.targets.find((t: any) => t.pathPrefix === '/site/' + alphaId),
    tb = workspace.targets.find((t: any) => t.pathPrefix === '/site/' + betaId);
  const a = await call('assessments', {
    name: 'TEST FIXTURE image baseline',
    targetId: ta.id,
    url: ta.origin + ta.pathPrefix,
    pages: 1,
  });
  baselineId = a.id;
  const b = await call('assessments', {
    name: 'TEST FIXTURE form baseline',
    targetId: tb.id,
    url: tb.origin + tb.pathPrefix + '/form',
    pages: 1,
  });
  const before = await completed(a.id),
    other = await completed(b.id);
  expect(before.findings.some((f: any) => f.ruleId === 'image-alt')).toBe(true);
  expect(other.findings.some((f: any) => f.ruleId === 'label')).toBe(true);
  expect(other.findings.some((f: any) => f.ruleId === 'image-alt')).toBe(false);
  const finding = before.findings.find((f: any) => f.ruleId === 'image-alt'),
    rid = finding.remediation.id,
    originalHash = finding.evidence[0].sha256;
  expect(before.runs[0].browserVersion).toBeTruthy();
  expect(before.runs[0].configuration.policy.origin).toBe(ta.origin);
  expect(before.buildLabel).toContain('@1');
  const evidence = await call('evidence/' + finding.evidence[0].id);
  expect(evidenceHash(evidence.payload)).toBe(evidence.sha256);
  const task = before.tasks.find((t: any) => t.kind === 'finding' && t.findingId === finding.id);
  await call('reviews/' + task.id, {
    reviewer: 'forged identity must be ignored',
    outcome: 'confirmed',
    notes:
      'TEST FIXTURE ONLY: browser inspection confirms the intentionally missing alt attribute on #service-image.',
    evidenceIds: [finding.evidence[0].id],
  });
  await call('reviews/' + task.id, {
    reviewer: 'forged identity',
    outcome: 'reopen',
    notes:
      'TEST FIXTURE ONLY: reopen the scanner validation to verify append-only decision history.',
    evidenceIds: [],
  });
  const history = await call('assessments/' + a.id);
  expect(history.tasks.find((t: any) => t.id === task.id).decisions).toHaveLength(2);
  expect(history.tasks.find((t: any) => t.id === task.id).decisions[0].reviewer).toContain(email);
  expect(history.tasks.find((t: any) => t.id === task.id).decisions[0].reviewer).not.toContain(
    'forged',
  );
  const v1 = await call('reports', { assessmentId: a.id });
  expect(v1.version).toBe(1);
  expect(
    (
      await api.post('/api/remediation/' + rid + '/verify', {
        data: {
          outcome: 'verified-resolved',
          notes:
            'TEST FIXTURE ONLY: this premature approval must be rejected because no independent retest has executed.',
        },
      })
    ).status(),
  ).toBe(409);
  await call('lab/' + alphaId, {
    config: { imageAlt: true, formLabels: true, contrast: true },
    notes: 'TEST FIXTURE: actual image HTML now includes an alternative.',
  });
  await page.goto(ta.origin + ta.pathPrefix);
  await expect(page.locator('#service-image')).toHaveAttribute('alt', 'Civic services');
  const retest = await call('remediation/' + rid + '/retest', {});
  cleanId = retest.id;
  const clean = await completed(retest.id);
  expect(clean.findings.some((f: any) => f.ruleId === 'image-alt')).toBe(false);
  expect(clean.matrix.every((r: any) => r.conclusion === null)).toBe(true);
  expect(clean.buildLabel).toContain('@2');
  await expect
    .poll(async () => {
      const x = await call('assessments/' + a.id);
      return x.findings.find((f: any) => f.id === finding.id).remediation.status;
    })
    .toBe('human-verification-required');
  const noFake = await api.patch('/api/remediation/' + rid, {
    data: {
      status: 'verified-resolved',
      notes: 'This direct status change must never resolve a finding.',
    },
  });
  expect(noFake.status()).toBe(400);
  await call('remediation/' + rid + '/verify', {
    outcome: 'verified-resolved',
    notes:
      'TEST FIXTURE ONLY: automated acceptance exercises the reviewer action after observing the image alt in the actual changed page and a clean independent axe retest. This is not a production human approval.',
  });
  const v2 = await call('reports', { assessmentId: retest.id });
  expect(v2.version).toBe(2);
  expect(v2.changes.removedFindings.some((key: string) => key.startsWith('image-alt'))).toBe(true);
  expect(v2.snapshot.assessment.buildLabel).toContain('@2');
  const doc = await api.get('/api/reports/' + v2.id);
  const bytes = await doc.body();
  await writeFile('.local/assurance-draft.docx', bytes);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain(retest.id);
  expect(xml).toContain('DRAFT ONLY');
  expect(hash(bytes)).toBe(v2.sha256);
  expect(xml).toContain('CONTROLLED TEST FIXTURE');
  const open = await call('reports/' + v2.id + '/openacr');
  expect(
    openacrDocument(v2.snapshot, { name: 'Fixture author', email }, v2.version).validation.valid,
  ).toBe(true);
  expect(open.product.name).toBe(before.name);
  await writeFile('.local/assurance.openacr.json', JSON.stringify(open, null, 2));
  expect(
    open.chapters.success_criteria_level_a.criteria[0].components[0].adherence,
  ).toBeUndefined();
  const pkg = await call('assessments/' + retest.id + '/packages', {});
  const response = await api.get('/api/packages/' + pkg.id),
    archive = await response.body();
  expect(hash(archive)).toBe(pkg.sha256);
  const packageZip = await JSZip.loadAsync(archive),
    manifest = JSON.parse(await packageZip.file('manifest.json')!.async('string'));
  for (const f of manifest.files)
    expect(hash(await packageZip.file(f.path)!.async('nodebuffer'))).toBe(f.sha256);
  expect(manifest.files.some((f: any) => f.path.endsWith('.html'))).toBe(true);
  const canonicalEvidence = JSON.parse(await packageZip.file('evidence.json')!.async('string'));
  for (const e of canonicalEvidence.filter((e: any) => e.hashScheme === 'canonical-json-sha256-v1'))
    expect(evidenceHash(e.payload), e.id).toBe(e.sha256);
  const lineage = JSON.parse(await packageZip.file('lineage.json')!.async('string'));
  expect(lineage.some((x: any) => x.id === baselineId)).toBe(true);
  expect(lineage.some((x: any) => x.id === retest.id)).toBe(true);
  await writeFile('.local/acceptance-evidence.zip', archive);
  await writeFile('.local/acceptance-package.sha256', pkg.sha256);
  await call('lab/' + alphaId, {
    config: { imageAlt: false, formLabels: true, contrast: true },
    notes: 'TEST FIXTURE: intentionally reintroduce the image defect for regression verification.',
  });
  const regression = await call('remediation/' + rid + '/retest', {});
  await completed(regression.id);
  await expect
    .poll(async () => {
      const x = await call('assessments/' + a.id);
      return x.findings.find((f: any) => f.id === finding.id).remediation.status;
    })
    .toBe('regressed');
  const final = await call('assessments/' + a.id);
  const lifecycle = final.findings.find((f: any) => f.id === finding.id).remediation;
  expect(lifecycle.events.some((e: any) => e.status === 'verified-resolved')).toBe(true);
  expect(final.findings.find((f: any) => f.id === finding.id).evidence[0].sha256).toBe(
    originalHash,
  );
  expect(final.reports).toHaveLength(2);
  await writeFile(
    '.local/assurance-measurements.json',
    JSON.stringify(
      {
        before: before.findings.map((f: any) => f.ruleId),
        secondWebsite: other.findings.map((f: any) => f.ruleId),
        retest: clean.findings.map((f: any) => f.ruleId),
        regressionStatus: lifecycle.status,
        reportVersions: [v1.version, v2.version],
        fixtureOnly: true,
      },
      null,
      2,
    ),
  );
});
test('safe multi-state form journey preserves validation-error and recovery evidence', async () => {
  const w = await call('workspace'),
    t = w.targets.find((t: any) => t.pathPrefix === '/site/' + betaId),
    url = t.origin + t.pathPrefix;
  const j = await call('journeys', {
    name: 'TEST FIXTURE form error and recovery',
    targetId: t.id,
    allowSubmission: true,
    steps: [
      { name: 'Navigate to service form', action: 'goto', url: url + '/form', scan: true },
      {
        name: 'Enter invalid email',
        action: 'fill',
        selector: '#email',
        value: 'invalid',
        scan: false,
      },
      { name: 'Submit invalid input', action: 'click', selector: '#submit-request', scan: true },
      {
        name: 'Correct the email',
        action: 'fill',
        selector: '#email',
        value: 'fixture@example.test',
        scan: false,
      },
      { name: 'Recover and submit', action: 'click', selector: '#submit-request', scan: true },
    ],
  });
  const a = await call('assessments', {
      name: 'TEST FIXTURE complete journey',
      targetId: t.id,
      journeyId: j.id,
      url,
      pages: 1,
    }),
    detail = await completed(a.id);
  expect(detail.journeySteps).toHaveLength(5);
  expect(detail.journeySteps.every((s: any) => s.status === 'completed')).toBe(true);
  expect(detail.pages).toHaveLength(4);
  const dom = await db.evidence.findMany({
    where: { page: { assessmentId: a.id }, kind: 'dom-snapshot' },
  });
  const text = dom.map((e) => (e.payload as any).html).join('\n');
  expect(text).toContain('Enter a valid email address.');
  expect(text).toContain('Request received. No data was transmitted.');
  expect(detail.tasks.filter((t: any) => t.kind === 'criterion')).toHaveLength(152);
  expect(detail.matrix.every((r: any) => r.conclusion === null)).toBe(true);
  const bad = await api.post('/api/journeys', {
    data: {
      name: 'Unsafe code fixture',
      targetId: t.id,
      steps: [{ name: 'Execute script', action: 'evaluate', value: 'fetch("http://localhost")' }],
    },
  });
  expect(bad.status()).toBe(400);
});
test('authentication, roles, project isolation, unsafe targets, and new public origin registration', async () => {
  const unauth = await requestFactory.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000',
    extraHTTPHeaders: { Origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000' },
  });
  expect((await unauth.get('/api/assessments')).status()).toBe(401);
  expect((await viewer.get('/api/assessments')).status()).toBe(200);
  expect(
    (
      await viewer.post('/api/assessments', {
        data: { name: 'Denied fixture', url: 'https://www.w3.org/WAI/demos/bad/before/home.html' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await operator.post('/api/reports', { data: { assessmentId: baselineId } })).status(),
  ).toBe(403);
  const base = await call('assessments/' + baselineId),
    task = base.tasks[0];
  expect(
    (
      await operator.post('/api/reviews/' + task.id, {
        data: {
          outcome: 'Supports',
          notes: 'Forged approval must not be accepted by an operator account.',
          observation: 'This is a denied role fixture, not an actual human assessment.',
        },
      })
    ).status(),
  ).toBe(403);
  const other = await db.project.findUnique({ where: { id: 'default' } });
  expect(other).toBeTruthy();
  for (const origin of [
    'http://127.0.0.1:55432',
    'https://127.0.0.1',
    'https://localhost',
    'https://169.254.169.254',
  ])
    expect(
      (
        await api.post('/api/targets', {
          data: { name: 'Unsafe fixture', origin, pathPrefix: '/' },
        })
      ).status(),
    ).toBeGreaterThanOrEqual(400);
  const workspace = await call('workspace');
  expect(
    (
      await operator.post('/api/findings/' + base.findings[0].id + '/explain', { data: {} })
    ).status(),
  ).toBe(workspace.ai.external ? 403 : 400);
  if (!workspace.gemini) {
    await call('settings', { name: workspace.project.name, retentionDays: 90, aiConsent: true });
    const ai = await operator.post('/api/findings/' + base.findings[0].id + '/explain', {
      data: {},
    });
    expect(ai.status()).toBe(400);
    expect((await ai.json()).error).toContain('AI assistance is disabled');
  }
  const target = await call('targets', {
    name: 'New permitted IANA example website',
    origin: 'https://example.com',
    pathPrefix: '/',
  });
  const a = await call('assessments', {
    name: 'TEST FIXTURE public target without code changes',
    url: 'https://example.com/',
    targetId: target.id,
    pages: 1,
  });
  const detail = await completed(a.id);
  expect(detail.runs[0].raw[0].url).toBe('https://example.com/');
  expect(detail.runs[0].raw[0].result.testEngine.name).toBe('axe-core');
  await unauth.dispose();
});
test('worker failures remain failed, restart persistence and loaded interface accessibility', async ({
  page,
  context,
}) => {
  const w = await call('workspace'),
    t = w.targets.find((t: any) => t.pathPrefix === '/site/' + alphaId);
  const failed = await createAssessment(
    {
      name: 'TEST FIXTURE offline navigation failure',
      url: t.origin + t.pathPrefix,
      targetId: t.id,
    },
    projectId,
    'TEST FIXTURE failure injector',
    undefined,
    true,
  );
  await db.assessment.update({ where: { id: failed.id }, data: { status: 'running' } });
  await scanAssessment(failed.id, { offline: true });
  const failure = await call('assessments/' + failed.id);
  expect(failure.status).toBe('failed');
  expect(failure.runs[0].status).toBe('failed');
  expect(failure.findings).toHaveLength(0);
  const interrupted = await createAssessment(
    {
      name: 'TEST FIXTURE interrupted worker recovery',
      url: t.origin + t.pathPrefix,
      targetId: t.id,
    },
    projectId,
    'TEST FIXTURE watchdog injector',
    undefined,
    true,
  );
  await db.assessment.update({
    where: { id: interrupted.id },
    data: { status: 'running', updatedAt: new Date(Date.now() - 240000) },
  });
  await db.scanRun.create({
    data: {
      assessmentId: interrupted.id,
      scannerVersion: 'TEST FIXTURE interrupted before browser launch',
      status: 'running',
    },
  });
  await expect
    .poll(
      async () => {
        return (await call('assessments/' + interrupted.id)).status;
      },
      { timeout: 15000 },
    )
    .toBe('failed');
  // Actual application restart against the same PostgreSQL records and sessions.
  const log = createWriteStream('.local/restart-test.log', { flags: 'a' });
  let child: ChildProcess | undefined;
  const start = async () => {
    child = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        'apps/web',
        '--hostname',
        '127.0.0.1',
        '--port',
        '3012',
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    await expect
      .poll(
        async () => {
          try {
            return (await api.get('http://127.0.0.1:3012/api/health')).status();
          } catch {
            return 0;
          }
        },
        { timeout: 15000 },
      )
      .toBe(200);
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const done = new Promise<void>((r) => child!.once('exit', () => r()));
      child.kill('SIGTERM');
      await done;
    }
  };
  try {
    await start();
    expect(
      (
        await (await api.get('http://127.0.0.1:3012/api/assessments/' + baselineId)).json()
      ).findings.some((f: any) => f.ruleId === 'image-alt'),
    ).toBe(true);
    await stop();
    await start();
    expect(
      (
        await (await api.get('http://127.0.0.1:3012/api/assessments/' + baselineId)).json()
      ).tasks.some((t: any) => t.decisions.length === 2),
    ).toBe(true);
  } finally {
    await stop();
    log.end();
  }
  await context.addCookies((await api.storageState()).cookies);
  for (const view of [
    'overview',
    'create',
    'findings',
    'matrix',
    'review',
    'remediation',
    'reports',
    'history',
    'lab',
    'journeys',
    'settings',
  ]) {
    await page.goto(`/?view=${view}&assessment=${baselineId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const ready: Record<string, string> = {
      overview: '.feature-title',
      create: '.form-panel',
      findings: '.filters',
      matrix: '.panel-note',
      review: '.review-form',
      remediation: '.backlog-item',
      reports: '.report-details',
      history: '.timeline-item',
      lab: '.ops-form',
      journeys: '.ops-form',
      settings: '.ops-form',
    };
    await expect(page.locator(ready[view]).first()).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      view,
    ).toEqual([]);
  }
  await page.goto('/?assessment=' + baselineId);
  await expect(page.locator('.feature-title')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/assurance-mobile.png', fullPage: true });
});
test('complete role and foreign-resource matrix rejects protected operations without disclosure', async () => {
  const w = await call('workspace'),
    t = w.targets.find((x: any) => x.pathPrefix === '/site/' + alphaId);
  const foreignOrg = await db.organization.create({
    data: { name: 'TEST FIXTURE foreign organization' },
  });
  const fp = await db.project.create({
    data: { organizationId: foreignOrg.id, name: 'TEST FIXTURE foreign project', isFixture: true },
  });
  let foreignId = '';
  const reviewer = await login('reviewer');
  try {
    const ft = await db.target.create({
      data: {
        projectId: fp.id,
        name: 'TEST FIXTURE foreign target',
        origin: t.origin,
        pathPrefix: t.pathPrefix,
        lab: true,
      },
    });
    const fa = await createAssessment(
      { name: 'TEST FIXTURE foreign real scan', url: ft.origin + ft.pathPrefix, targetId: ft.id },
      fp.id,
      'TEST FIXTURE foreign operator',
      undefined,
      true,
    );
    foreignId = fa.id;
    await db.assessment.update({ where: { id: fa.id }, data: { status: 'running' } });
    await scanAssessment(fa.id);
    const detail = await db.assessment.findUniqueOrThrow({
      where: { id: fa.id },
      include: { findings: { include: { remediation: true, evidence: true } }, tasks: true },
    });
    expect(detail.status).toBe('completed');
    expect(detail.findings.length).toBeGreaterThan(0);
    const report = await generateReport(fa.id, {
      name: 'TEST FIXTURE export author',
      email: 'foreign@fixture.test',
      actor: 'TEST FIXTURE author',
    });
    const pkg = await createEvidencePackage(fa.id, 'TEST FIXTURE packager');
    const f = detail.findings[0],
      eid = f.evidence[0].id;
    for (const route of [
      'assessments/' + fa.id,
      'evidence/' + eid,
      'evidence/' + eid + '/screenshot',
      'reports/' + report.id,
      'reports/' + report.id + '/manifest',
      'reports/' + report.id + '/openacr',
      'packages/' + pkg.id,
      'packages/' + pkg.id + '/digest',
    ]) {
      const r = await api.get('/api/' + route);
      expect(r.status(), route).toBe(404);
      expect(await r.text()).not.toContain('TEST FIXTURE foreign real scan');
    }
    for (const [route, body] of [
      [
        'reviews/' + detail.tasks[0].id,
        { outcome: 'reopen', notes: 'TEST FIXTURE attempt to modify foreign review.' },
      ],
      ['remediation/' + f.remediation!.id + '/retest', {}],
      ['reports', { assessmentId: fa.id }],
      ['assessments/' + fa.id + '/cancel', {}],
      ['projects/switch', { projectId: fp.id }],
    ] as [string, unknown][])
      expect((await api.post('/api/' + route, { data: body })).status(), route).toBe(404);
    expect(
      (await api.delete('/api/assessments/' + fa.id, { data: { confirm: fa.id } })).status(),
    ).toBe(404);
    const base = await call('assessments/' + baselineId);
    for (const client of [viewer, operator, reviewer]) {
      expect(
        (
          await client.post('/api/users', {
            data: {
              name: 'TEST FIXTURE unauthorized member',
              email: randomUUID() + '@fixture.test',
              role: 'admin',
            },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await client.delete('/api/assessments/' + baselineId, { data: { confirm: baselineId } })
        ).status(),
      ).toBe(403);
    }
    for (const route of [
      'reports',
      'assessments/' + baselineId + '/packages',
      'reviews/' + base.tasks[0].id,
      'remediation/' + base.findings[0].remediation.id + '/verify',
    ]) {
      const body = route === 'reports' ? { assessmentId: baselineId } : {};
      expect((await viewer.post('/api/' + route, { data: body })).status(), route).toBe(403);
    }
    expect(
      (await reviewer.post('/api/reports', { data: { assessmentId: baselineId } })).status(),
    ).toBe(201);
    const forbidden = await api.post('/api/projects', {
      data: { name: 'CSRF must be denied' },
      headers: { Origin: 'https://evil.test' },
    });
    expect(forbidden.status()).toBe(403);
    const invited = await call('users', {
      name: 'TEST FIXTURE invited member',
      email: randomUUID() + '@fixture.test',
      role: 'viewer',
    });
    const invitedContext = await requestFactory.newContext({
      baseURL: process.env.TEST_BASE_URL,
      extraHTTPHeaders: { Origin: process.env.APP_ORIGIN! },
    });
    expect(
      (
        await invitedContext.post('/api/auth/accept', { data: { token: invited.token, password } })
      ).status(),
    ).toBe(200);
    expect((await invitedContext.get('/api/assessments')).status()).toBe(200);
    expect(
      (
        await invitedContext.post('/api/auth/accept', { data: { token: invited.token, password } })
      ).status(),
    ).toBe(403);
    await invitedContext.dispose();
  } finally {
    if (foreignId) await deleteAssessment(foreignId, fp.id, 'TEST FIXTURE cleanup');
    await db.target.deleteMany({ where: { projectId: fp.id } });
    await db.projectEvent.deleteMany({ where: { projectId: fp.id } });
    await db.project.delete({ where: { id: fp.id } });
    await db.organization.delete({ where: { id: foreignOrg.id } });
    await reviewer.dispose();
  }
});
test('bounded concurrent queue, immutable retries, cancellation and failed writes', async () => {
  const w = await call('workspace'),
    t = w.targets.find((x: any) => x.pathPrefix === '/site/' + alphaId);
  const key = randomUUID(),
    payload = {
      name: 'TEST FIXTURE idempotent request',
      url: t.origin + t.pathPrefix,
      targetId: t.id,
    };
  const duplicate = await Promise.all(
    [1, 2].map(() =>
      api.post('/api/assessments', { data: payload, headers: { 'Idempotency-Key': key } }),
    ),
  );
  const ids = await Promise.all(
    duplicate.map(async (r) => {
      expect(r.status()).toBe(201);
      return (await r.json()).id;
    }),
  );
  expect(ids[0]).toBe(ids[1]);
  await completed(ids[0]);
  expect(
    (
      await api.post('/api/assessments', {
        data: { ...payload, name: 'TEST FIXTURE different scope' },
        headers: { 'Idempotency-Key': key },
      })
    ).status(),
  ).toBe(409);
  const started = Date.now();
  const jobs = await Promise.all(
    [1, 2, 3, 4].map((i) =>
      call('assessments', {
        name: 'TEST FIXTURE controlled load ' + i,
        url: t.origin + t.pathPrefix,
        targetId: t.id,
      }),
    ),
  );
  let peakRunning = 0;
  while (true) {
    const rows = await db.assessment.findMany({ where: { id: { in: jobs.map((x) => x.id) } } });
    peakRunning = Math.max(peakRunning, rows.filter((x) => x.status === 'running').length);
    if (rows.every((x) => x.status === 'completed')) break;
    if (rows.some((x) => x.status === 'failed')) throw new Error('Controlled load job failed');
    if (Date.now() - started > 90000) throw new Error('Controlled load timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(peakRunning).toBe(1);
  await writeFile(
    '.local/release-load.json',
    JSON.stringify(
      {
        fixtureOnly: true,
        assessments: 4,
        peakRunning,
        elapsedMs: Date.now() - started,
        jobs: jobs.map((x) => x.id),
      },
      null,
      2,
    ),
  );
  const canceled = await createAssessment(
    { name: 'TEST FIXTURE cancel queued', url: t.origin + t.pathPrefix, targetId: t.id },
    projectId,
    'TEST FIXTURE operator',
    undefined,
    true,
  );
  expect(
    (await api.post('/api/assessments/' + canceled.id + '/cancel', { data: {} })).status(),
  ).toBe(200);
  expect((await call('assessments/' + canceled.id)).status).toBe('cancelled');
  const retry = await call('assessments/' + canceled.id + '/retry', {});
  await completed(retry.id);
  expect((await call('assessments/' + retry.id)).attempt).toBe(2);
  expect(
    (await api.post('/api/assessments/' + canceled.id + '/retry', { data: {} })).status(),
  ).toBe(409);
  const a = await createAssessment(
    { name: 'TEST FIXTURE failed artifact write', url: t.origin + t.pathPrefix, targetId: t.id },
    projectId,
    'TEST FIXTURE operator',
    undefined,
    true,
  );
  await mkdir(localPath('evidence'), { recursive: true });
  await writeFile(
    localPath('evidence', a.id),
    'A real file blocks directory creation in this fixture.',
  );
  try {
    await db.assessment.update({ where: { id: a.id }, data: { status: 'running' } });
    await scanAssessment(a.id);
    expect((await call('assessments/' + a.id)).status).toBe('failed');
  } finally {
    await rm(localPath('evidence', a.id), { force: true });
  }
  let exhausted = await call('assessments', {
    name: 'TEST FIXTURE retry exhaustion',
    url: t.origin + t.pathPrefix + '?redirect=http://127.0.0.1:55432/',
    targetId: t.id,
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await expect
      .poll(async () => (await call('assessments/' + exhausted.id)).status, { timeout: 30000 })
      .toBe('failed');
    if (attempt < 3) exhausted = await call('assessments/' + exhausted.id + '/retry', {});
  }
  expect(
    (await api.post('/api/assessments/' + exhausted.id + '/retry', { data: {} })).status(),
  ).toBe(409);
  // Existing source bytes cannot be silently altered and downloaded as trusted evidence.
  const baseline = await call('assessments/' + baselineId),
    ev = baseline.pages[0].evidence[0],
    file = ev.screenshot;
  const bytes = await readFile(file);
  try {
    await writeFile(file, Buffer.from('TEST FIXTURE corrupted bytes'));
    expect((await api.get('/api/evidence/' + ev.id + '/screenshot')).status()).toBe(409);
    expect(
      (await api.post('/api/assessments/' + baselineId + '/packages', { data: {} })).status(),
    ).toBe(409);
  } finally {
    await writeFile(file, bytes);
  }
});
test('W3C Before/After integration still uses independent real browser runs', async () => {
  const b = await call('assessments', {
      name: 'TEST FIXTURE W3C Before integration',
      url: 'https://www.w3.org/WAI/demos/bad/before/home.html',
      pages: 4,
    }),
    a = await call('assessments', {
      name: 'TEST FIXTURE W3C After integration',
      url: 'https://www.w3.org/WAI/demos/bad/after/home.html',
      pages: 4,
    });
  const before = await completed(b.id),
    after = await completed(a.id);
  expect(before.findings.length).toBeGreaterThan(0);
  expect(after.runs[0].raw[0].result.testEngine.name).toBe('axe-core');
  const comparison = await call(`compare?before=${b.id}&after=${a.id}`);
  expect(comparison.completed).toBe(true);
  expect(comparison.denominator).toBeGreaterThan(0);
  expect(comparison.targetAchieved).toBe(false);
  await writeFile(
    '.local/release-benchmark.json',
    JSON.stringify({ beforeId: b.id, afterId: a.id, ...comparison }, null, 2),
  );
});

test('actual PostgreSQL backup and fresh-database restore preserve evidence and report hashes', async () => {
  const u = new URL(process.env.DATABASE_URL!),
    restoredName = 'trace508_restore_test';
  expect(u.pathname.endsWith('_release_test')).toBe(true);
  const args = ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username)],
    env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  execFileSync('createdb', [...args, restoredName], { env });
  const restoredURL = new URL(u);
  restoredURL.pathname = '/' + restoredName;
  const restored = new PrismaClient({ datasources: { db: { url: restoredURL.href } } });
  try {
    execFileSync(
      'pg_dump',
      [...args, '-d', u.pathname.slice(1), '-Fc', '-f', '.local/release-restore.dump'],
      { env },
    );
    execFileSync(
      'pg_restore',
      [...args, '-d', restoredName, '--no-owner', '--exit-on-error', '.local/release-restore.dump'],
      { env },
    );
    const backupPaths = await db.assessment.findMany({
      where: { projectId },
      select: { id: true, reports: { select: { path: true } } },
    });
    const members = backupPaths.flatMap((a) => [
      'evidence/' + a.id,
      ...a.reports.map((r) => 'reports/' + r.path.split('/').pop()),
    ]);
    const existing = [];
    for (const member of members) {
      try {
        await access('.local/' + member);
        existing.push(member);
      } catch {}
    }
    await mkdir('.local/release-restored-artifacts', { recursive: true, mode: 0o700 });
    execFileSync('tar', ['czf', '.local/release-artifacts.tgz', '-C', '.local', ...existing]);
    execFileSync('tar', [
      'xzf',
      '.local/release-artifacts.tgz',
      '-C',
      '.local/release-restored-artifacts',
    ]);
    const original = await db.assessment.findUniqueOrThrow({
      where: { id: baselineId },
      include: { findings: { include: { evidence: true } }, reports: true },
    });
    const copy = await restored.assessment.findUniqueOrThrow({
      where: { id: baselineId },
      include: { findings: { include: { evidence: true } }, reports: true },
    });
    expect(copy.findings.length).toBe(original.findings.length);
    expect(copy.findings.map((f) => f.evidence.map((e) => e.sha256))).toEqual(
      original.findings.map((f) => f.evidence.map((e) => e.sha256)),
    );
    for (const r of copy.reports) {
      expect(hash(await readFile(r.path))).toBe(r.sha256);
      expect(
        hash(
          await readFile('.local/release-restored-artifacts/reports/' + r.path.split('/').pop()),
        ),
      ).toBe(r.sha256);
    }
    const scan = await restored.evidence.findFirstOrThrow({
      where: { page: { assessmentId: baselineId }, kind: 'scan' },
    });
    if (scan.screenshotSha256)
      expect(
        hash(
          await readFile(
            '.local/release-restored-artifacts/evidence/' + baselineId + '/' + scan.pageId + '.png',
          ),
        ),
      ).toBe(scan.screenshotSha256);
    expect(await restored.reviewerDecision.count()).toBe(await db.reviewerDecision.count());
    await writeFile(
      '.local/release-restore.json',
      JSON.stringify(
        {
          fixtureOnly: true,
          restoredDatabase: restoredName,
          findings: copy.findings.length,
          reports: copy.reports.length,
          reviewDecisions: await restored.reviewerDecision.count(),
          databaseRestored: true,
          artifactHashesVerified: true,
          artifactTarRestore: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await restored.$disconnect();
    execFileSync('dropdb', [...args, restoredName], { env });
    await rm('.local/release-restore.dump', { force: true });
    await rm('.local/release-artifacts.tgz', { force: true });
    await rm('.local/release-restored-artifacts', { recursive: true, force: true });
  }
});
test('sign-in, explicit role-based account revocation and logout operate through the UI', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Trace508' })).toBeVisible();
  const check = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(check.violations).toHaveLength(0);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.page-heading h1')).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { email: 'viewer-' + email } });
  expect((await api.patch('/api/users/' + user.id, { data: { disabled: true } })).status()).toBe(
    200,
  );
  expect((await viewer.get('/api/assessments')).status()).toBe(401);
  expect((await api.patch('/api/users/' + user.id, { data: { disabled: false } })).status()).toBe(
    200,
  );
  const cookie = (await page.context().cookies()).find((c) => c.name === 'trace508_session')!;
  await db.session.update({
    where: { id: hash(cookie.value) },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to Trace508' })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.page-heading h1')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Trace508' })).toBeVisible();
});
