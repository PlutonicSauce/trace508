#!/bin/sh
# Use a dedicated empty PostgreSQL database ending in _release_test.
set -eu
: "${DATABASE_URL:?Set a dedicated _release_test DATABASE_URL}"
node -e 'if(!new URL(process.env.DATABASE_URL).pathname.endsWith("_release_test"))process.exit(1)'
export APP_ORIGIN=${APP_ORIGIN:-http://127.0.0.1:3020}
export TEST_BASE_URL=$APP_ORIGIN
export ENABLE_LAB=true
export LAB_ORIGIN=${LAB_ORIGIN:-http://127.0.0.1:4320}
export AI_PROVIDER=none
mkdir -p .local
npm ci
npx playwright install chromium
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm test
node --import tsx tests/integration/bootstrap.ts
npm run build
node node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3020 > .local/release-web.log 2>&1 &
release_web_pid=$!
node --import tsx workers/scan/index.ts > .local/release-worker.log 2>&1 &
release_worker_pid=$!
node --import tsx workers/lab/index.ts > .local/release-lab.log 2>&1 &
release_lab_pid=$!
trap 'kill "$release_web_pid" "$release_worker_pid" "$release_lab_pid" 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -fsS "$APP_ORIGIN/api/health" && break || sleep 1; done
npm run test:assurance
kill "$release_worker_pid"
wait "$release_worker_pid"
node --import tsx tests/integration/worker-faults.ts
python3 scripts/verify-package.py .local/acceptance-evidence.zip "$(cat .local/acceptance-package.sha256)"
node --import tsx scripts/verify-openacr.ts .local/assurance.openacr.json
npm audit --omit=dev --audit-level=high
