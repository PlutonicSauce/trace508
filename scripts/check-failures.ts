import { db } from '../packages/core/src/db';
import { scanAssessment } from '../workers/scan/scanner';
import { stableId } from '../packages/core/src/ids';
import { randomUUID } from 'node:crypto';
const id = randomUUID(),
  url = 'https://www.w3.org/WAI/demos/bad/before/home.html';
await db.assessment.create({
  data: {
    id,
    name: 'Temporary missing-browser failure test',
    url,
    variant: 'before',
    status: 'running',
    pages: { create: { id: stableId(id, url), url } },
  },
});
try {
  await scanAssessment(id, process.env.TRACE508_TEST_OFFLINE === '1' ? { offline: true } : {});
  const a = await db.assessment.findUniqueOrThrow({
    where: { id },
    include: { runs: true, findings: true },
  });
  if (a.status !== 'failed' || a.runs[0].status !== 'failed' || a.findings.length)
    throw new Error('Failure propagation assertion failed');
  console.log(
    `PASS: actual ${process.env.TRACE508_TEST_OFFLINE === '1' ? 'network navigation' : 'browser launch'} failure persists failed assessment and failed run, with zero invented findings.`,
  );
} finally {
  await db.assessment.delete({ where: { id } });
  await db.$disconnect();
}
