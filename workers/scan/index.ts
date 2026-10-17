import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../../packages/core/src/db';
import { scanAssessment } from './scanner';
import { claimJob, recoverInterrupted, renewLease, releaseLease } from './queue';
let lastDatabaseSuccess=Date.now();
const watchdog=setInterval(()=>{if(Date.now()-lastDatabaseSuccess>45000){console.error(JSON.stringify({event:"worker-database-stall",action:"exit-for-supervised-restart"}));process.exit(1);}},5000);
let stopping = false,
  failures = 0;
const owner = randomUUID();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
  });
console.log(
  'Trace508 worker ready; durable global concurrency=1, leased claims; interrupted jobs require fresh bounded retry.',
);
while (!stopping) {
  try {
    await recoverInterrupted();
    lastDatabaseSuccess=Date.now();
    const id = await claimJob(owner);
    if (id) {
      let leaseError = false;
      const heartbeat = setInterval(
        () =>
          void renewLease(owner, id).then(()=>{lastDatabaseSuccess=Date.now();}).catch(() => {
            leaseError = true;
          }),
        5000,
      );
      const scanDeadline=setTimeout(()=>{console.error(JSON.stringify({event:'worker-job-stall',assessmentId:id,action:'exit-for-supervised-restart'}));process.exit(1);},135000);
      try {
        await scanAssessment(id, { leaseValid: () => !leaseError });
      } finally {
        clearInterval(heartbeat);clearTimeout(scanDeadline);
        await releaseLease(owner);
      }
    } else await new Promise((r) => setTimeout(r, 1500));
    failures = 0;
  } catch (e) {
    failures++;
    await Promise.race([db.$disconnect(),new Promise(r=>setTimeout(r,3000))]);
    console.error(
      JSON.stringify({
        event: 'worker-cycle-failed',
        type: e instanceof Error ? e.name : 'unknown',
      code:e&&typeof e==='object'&&'code'in e?e.code:undefined,
        retryInMs: Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
      }),
    );
    await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** Math.min(failures, 5))));
  }
}
clearInterval(watchdog);
await releaseLease(owner).catch(() => {});
await db.$disconnect();
