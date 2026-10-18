import { db } from '../packages/core/src/db';
import { createAssessment, getAssessment } from '../packages/core/src/assessment';
import { scanAssessment } from '../workers/scan/scanner';
import { benchmark } from '../packages/core/src/benchmark';
import { writeFile } from 'node:fs/promises';

console.log('--- Scanning W3C BAD Reference Demonstrations with Updated Engine ---');

// 1. Create fresh Before assessment
console.log('Creating W3C Before Assessment (4 pages)...');
const beforeRecord = await createAssessment(
  {
    name: 'W3C BAD Demonstration · Before (Interactive Probes)',
    url: 'https://www.w3.org/WAI/demos/bad/before/home.html',
    pages: 4,
  },
  'default',
);
console.log(`Created Before Assessment: ${beforeRecord.id}`);

// 2. Create fresh After assessment
console.log('Creating W3C After Assessment (4 pages)...');
const afterRecord = await createAssessment(
  {
    name: 'W3C BAD Demonstration · After (Interactive Probes)',
    url: 'https://www.w3.org/WAI/demos/bad/after/home.html',
    pages: 4,
  },
  'default',
);
console.log(`Created After Assessment: ${afterRecord.id}`);

// 3. Run scanner on Before
console.log(`\nScanning Before Assessment ${beforeRecord.id}...`);
await db.assessment.update({
  where: { id: beforeRecord.id },
  data: { status: 'running' },
});
await scanAssessment(beforeRecord.id);
console.log('Before Assessment scan complete.');

// 4. Run scanner on After
console.log(`\nScanning After Assessment ${afterRecord.id}...`);
await db.assessment.update({
  where: { id: afterRecord.id },
  data: { status: 'running' },
});
await scanAssessment(afterRecord.id);
console.log('After Assessment scan complete.');

// 5. Run Benchmark
console.log('\nRunning Benchmark comparison between fresh Before and After assessments...');
const beforeDetail = await getAssessment(beforeRecord.id);
const afterDetail = await getAssessment(afterRecord.id);

if (!beforeDetail || !afterDetail) {
  throw new Error('Failed to retrieve assessment details');
}

const result = benchmark(beforeDetail, afterDetail);
await writeFile('.local/benchmark.json', JSON.stringify(result, null, 2));

console.log('\n================ BENCHMARK RESULTS ================');
console.log(
  JSON.stringify(
    {
      beforeId: beforeRecord.id,
      afterId: afterRecord.id,
      beforeFindingCount: result.beforeFindingCount,
      afterFindingCount: result.afterFindingCount,
      denominator: result.denominator,
      candidateNumerator: result.candidateNumerator,
      verifiedNumerator: result.verifiedNumerator,
      verifiedRecall: result.verifiedRecall,
      targetAchieved: result.targetAchieved,
      referenceUnitsWithoutCandidate: result.referenceUnitsWithoutCandidate,
    },
    null,
    2,
  ),
);

// Summary of findings by rule
const beforeFindingsByRule: Record<string, number> = {};
for (const f of beforeDetail.findings) {
  beforeFindingsByRule[f.ruleId] = (beforeFindingsByRule[f.ruleId] || 0) + 1;
}
console.log('\nBefore Findings by Rule:');
console.table(beforeFindingsByRule);

const afterFindingsByRule: Record<string, number> = {};
for (const f of afterDetail.findings) {
  afterFindingsByRule[f.ruleId] = (afterFindingsByRule[f.ruleId] || 0) + 1;
}
console.log('\nAfter Findings by Rule:');
console.table(afterFindingsByRule);

console.log('Benchmark JSON updated at .local/benchmark.json');
await db.$disconnect();
