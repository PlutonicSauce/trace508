import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
let stopping = false,
  child: ChildProcess | undefined,
  failures = 0,
  lastStart = Date.now();
for (const s of ['SIGINT', 'SIGTERM'] as const)
  process.on(s, () => {
    stopping = true;
    child?.kill(s);
  });
while (!stopping) {
  lastStart = Date.now();
  child = spawn(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'index.ts')], {
    stdio: 'inherit',
    env: process.env,
  });
  const exit = await new Promise<number | null>((resolve, reject) => {
    child!.once('exit', resolve);
    child!.once('error', reject);
  });
  if (stopping || exit === 0) break;
  failures = Date.now() - lastStart > 300000 ? 1 : failures + 1;
  console.error(JSON.stringify({ event: 'worker-supervisor-restart', attempt: failures, exit }));
  if (failures >= 3) {
    console.error('Worker restart budget exhausted. Operator investigation required.');
    process.exitCode = 1;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000 * 2 ** failures));
}
