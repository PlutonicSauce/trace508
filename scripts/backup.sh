#!/bin/sh
# Run during a maintenance window. Only Compose storage is backed up.
set -eu
backup_dir=${1:?Pass a new private backup directory}
[ ! -e "$backup_dir" ] || { echo 'Backup destination must be new'; exit 1; }
mkdir -m 700 "$backup_dir"
umask 077
docker compose stop worker browser web
trap 'docker compose start browser web worker >/dev/null' EXIT
docker compose exec -T db pg_dump -U trace508 -d trace508 -Fc > "$backup_dir/database.dump"
docker compose run --rm --no-deps --entrypoint tar web czf - -C /app/.local . > "$backup_dir/evidence.tgz"
(cd "$backup_dir" && shasum -a 256 database.dump evidence.tgz > SHA256SUMS)
echo 'Backup complete. Keep the database secret and encryption keys in your approved secret store.'
