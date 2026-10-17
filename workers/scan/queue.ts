import { db } from '../../packages/core/src/db';
import { reconcileRetests } from '../../packages/core/src/remediation';
export const LEASE_MS = 45000;
export async function recoverInterrupted() {
  const stale = await db.assessment.findMany({
    where: {
      status: { in: ['running', 'preparing'] },
      updatedAt: { lt: new Date(Date.now() - 180000) },
    },
    select: { id: true },
  });
  for (const a of stale) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(50803)`;
      const lease = await tx.workerLease.findUnique({ where: { id: 'scanner' } });
      if (lease?.assessmentId === a.id && lease.expiresAt > new Date()) return;
      const changed = await tx.assessment.updateMany({
        where: {
          id: a.id,
          status: { in: ['running', 'preparing'] },
          updatedAt: { lt: new Date(Date.now() - 180000) },
        },
        data: {
          status: 'failed',
          error: 'Worker lease expired. A fresh bounded retry preserves original partial evidence.',
          progress: 'Worker interrupted',
        },
      });
      if (changed.count) {
        await tx.scanRun.updateMany({
          where: { assessmentId: a.id, status: 'running' },
          data: { status: 'failed', error: 'Worker lease expired', completedAt: new Date() },
        });
        await tx.journeyStepRun.updateMany({
          where: { assessmentId: a.id, status: 'running' },
          data: { status: 'failed', error: 'Worker interrupted', completedAt: new Date() },
        });
        await tx.auditEvent.create({
          data: {
            assessmentId: a.id,
            actor: 'scan-worker',
            action: 'worker-expired',
            detail:
              'Interrupted job failed. No partial evidence overwritten; retry must use a new assessment.',
          },
        });
      }
    });
    await reconcileRetests(a.id);
  }
}
export async function claimJob(owner: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(50803)`;
    const lease = await tx.workerLease.findUnique({ where: { id: 'scanner' } });
    if (lease && lease.expiresAt > new Date()) return null;
    const claimed = await tx.$queryRaw<
      { id: string }[]
    >`UPDATE "Assessment" SET status='running',progress='Worker acquired job',"updatedAt"=NOW() WHERE id=(SELECT id FROM "Assessment" WHERE status='queued' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
    const id = claimed[0]?.id;
    if (!id) return null;
    await tx.workerLease.upsert({
      where: { id: 'scanner' },
      create: {
        id: 'scanner',
        owner,
        assessmentId: id,
        expiresAt: new Date(Date.now() + LEASE_MS),
      },
      update: {
        owner,
        assessmentId: id,
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + LEASE_MS),
      },
    });
    return id;
  });
}
export async function renewLease(owner: string, id: string) {
  const changed = await db.workerLease.updateMany({
    where: { id: 'scanner', owner, assessmentId: id, expiresAt: { gt: new Date() } },
    data: { heartbeatAt: new Date(), expiresAt: new Date(Date.now() + LEASE_MS) },
  });
  if (!changed.count) throw new Error('Worker lease lost');
  await db.assessment.updateMany({
    where: { id, status: 'running' },
    data: { updatedAt: new Date() },
  });
}
export const releaseLease = (owner: string) =>
  db.workerLease.deleteMany({ where: { id: 'scanner', owner } });
