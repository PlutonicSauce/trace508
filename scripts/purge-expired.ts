import { db } from '../packages/core/src/db';
import { deleteAssessment } from '../packages/core/src/provenance';
const records = await db.assessment.findMany({
  where: { expiresAt: { lt: new Date() }, status: { notIn: ['queued', 'running', 'preparing'] } },
  select: { id: true, projectId: true, name: true, expiresAt: true },
});
if (!process.argv.includes('--confirm-expired'))
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        records,
        next: 'Pass --confirm-expired after reviewing. This permanently removes expired assessment evidence and reports.',
      },
      null,
      2,
    ),
  );
else
  for (const a of records) {
    await deleteAssessment(a.id, a.projectId, 'trusted-retention-operator');
    console.log('Deleted expired assessment', a.id);
  }
await db.$disconnect();
