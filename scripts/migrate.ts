import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import 'dotenv/config';
if (process.env.DATABASE_URL_FILE)
  process.env.DATABASE_URL = readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim();
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
