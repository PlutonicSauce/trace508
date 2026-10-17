import { db } from '../packages/core/src/db';
const assessments = await db.assessment.findMany({
  include: {
    _count: {
      select: { findings: true, pages: true, tasks: true, reports: true, benchmarkDecisions: true },
    },
    runs: true,
  },
  orderBy: { createdAt: 'asc' },
});
console.log(
  JSON.stringify(
    assessments.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      counts: a._count,
      scanner: a.runs.map((r) => ({ version: r.scannerVersion, status: r.status })),
    })),
    null,
    2,
  ),
);
console.log(
  'Evidence',
  await db.evidence.count(),
  'Reviewer decisions',
  await db.reviewerDecision.count(),
);
await db.$disconnect();
