#!/bin/sh
# Restore ONLY into a fresh empty Compose deployment, never an existing production database.
set -eu
backup_dir=${1:?Pass the verified backup directory}
[ "${CONFIRM_FRESH_RESTORE:-}" = YES ] || { echo 'Set CONFIRM_FRESH_RESTORE=YES only for a fresh empty destination'; exit 1; }
(cd "$backup_dir" && shasum -a 256 -c SHA256SUMS)
docker compose up -d db
until docker compose exec -T db pg_isready -U trace508 >/dev/null; do sleep 2; done
count=$(docker compose exec -T db psql -U trace508 -d trace508 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[ "$count" = 0 ] || { echo 'Refusing restore into a nonempty database'; exit 1; }
docker compose exec -T db pg_restore -U trace508 -d trace508 --no-owner --exit-on-error < "$backup_dir/database.dump"
docker compose run --rm --no-deps --entrypoint tar web xzf - -C /app/.local < "$backup_dir/evidence.tgz"
docker compose up -d
echo 'Restore completed. Independently verify record counts, source/report hashes, login and a fresh scan before reopening access.'
