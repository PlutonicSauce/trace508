import { db } from '../packages/core/src/db';
import { getAssessment } from '../packages/core/src/assessment';
import { benchmark } from '../packages/core/src/benchmark';
import { writeFile } from 'node:fs/promises';
const rows = await db.assessment.findMany({
  where: { status: 'completed' },
  orderBy: { createdAt: 'asc' },
});
const before = rows.find((r) => r.variant === 'before'),
  after = rows.find((r) => r.variant === 'after');
if (!before || !after) throw new Error('Run real Before and After scans first.');
const result = benchmark((await getAssessment(before.id))!, (await getAssessment(after.id))!);
await writeFile('.local/benchmark.json', JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      before: before.id,
      after: after.id,
      denominator: result.denominator,
      candidates: result.candidateNumerator,
      verified: result.verifiedNumerator,
      recall: result.verifiedRecall,
      targetAchieved: result.targetAchieved,
    },
    null,
    2,
  ),
);
await db.$disconnect();
