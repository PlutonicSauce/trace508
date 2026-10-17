# Self-hosted deployment

Verdict: **BLOCKED for release approval** pending a successful clean container/HTTPS/network/restore run. This environment's attempted build failed installing Chromium with ENOSPC/EIO; the daemon's supported restart also timed out. Do not treat the following configuration as verified deployment.

## Requirements and installation

Use an operationally maintained Linux Docker/Compose host with at least 2 CPUs, 4 GB RAM and **15 GB free disk** for image construction, browser dependencies and retained evidence. Size storage from actual scope/retention; 15 GB is a build prerequisite estimate, not a measured capacity guarantee. Preserve package-lock.json and the database/artifact volumes. Use Node 24 for native/CI tooling. Public cloud hosting is not assumed free.

From a clean source checkout:

```sh
python3 scripts/deployment-secrets.py
export APP_ORIGIN=https://trace508.your-domain.example
export SITE_ADDRESS=trace508.your-domain.example
export HTTPS_BIND=0.0.0.0:443
docker compose config --quiet
docker compose up --build -d --wait
docker compose logs --no-color migrate worker browser egress web
curl --fail "$APP_ORIGIN/api/health"
```

The domain must resolve to the host and its ACME validation path must be available. The production proxy uses Caddy HTTPS. Port 443 is the only published service; PostgreSQL, browser control, egress, worker and migration have no published ports. No Docker socket mounts exist. For isolated local TLS verification use `SITE_ADDRESS=localhost`, `APP_ORIGIN=https://localhost:8443` and `-f compose.yaml -f deploy/compose.test.yaml`. This uses an internal CA; curl `--insecure` in that test is not evidence of publicly trusted TLS.

Secret files live under a private directory, are not baked into the image, and are excluded by .dockerignore. `DATABASE_URL_FILE` is consumed server-side; `POSTGRES_PASSWORD_FILE` initializes PostgreSQL. Review actual container secret-file readability and rotate/migrate secrets using your approved secret manager. The generated URL and password must remain consistent. No credentials are built into Compose.

## Trusted initialization

Run only after migrations and seed complete:

```sh
docker compose exec web npm run bootstrap:issue
# Only after inspecting existing legacy evidence ownership:
docker compose exec web npm run bootstrap:issue -- --adopt-legacy
# Retrieve the protected /app/.local/bootstrap-token through your trusted operator channel.
```

Enter the token, name, organization, email and a new 15-character-or-longer password in setup. Token validity is one hour and one successful consumption. The UI cannot independently grant admin access. Keep the endpoint behind trusted access until initialized. Existing authenticated installations stay initialized and require an administrator audit, not bootstrap replay.

Invitations and account recovery are administrator-controlled; tokens are transferred through an approved channel. They do not verify email ownership. Last-administrator recovery is an operator action: `npm run bootstrap:issue -- --recover EMAIL`. MFA/SSO/email verification and a deployment-appropriate compromised-password blocklist remain release blockers where identity assurance is required.

## Scanner isolation and operations

The browser service has no DB/AI secrets or artifact volume and sits on an internal-only network. Egress is an explicit public-HTTPS CONNECT proxy with DNS/IP denial/pinning. The worker has DB and browser protocol access but no public egress route. Web uses data and frontend networks. The native fixture exception is disabled in Compose.

Nonroot user, read-only image filesystem, tmpfs, dropped capabilities, no-new-privileges, process/memory/CPU limits and Linux Chromium sandbox are requested in configuration. They must all be verified on the destination kernel. Do not silently set BROWSER_SANDBOX=false or add privileged capabilities to make an operational gate appear green. If the sandbox fails, record the failure and choose an appropriately isolated host/runtime.

`/api/health` checks database reachability without returning secrets. Container web health is configured. Worker JSON events include cycle failures, stalled DB restart and restart-budget exhaustion. Monitor worker lease/queue age, restart counts, free disk, storage growth, failed jobs, backup freshness and certificate renewal. Central log retention/redaction and alert transport are deployment tasks, not implemented monitoring integrations.

On SIGTERM the worker stops taking jobs and allows a bounded active scan to finish; Compose grants 150 seconds. DB stalls have a watchdog; the supervisor restarts failures within a bounded budget. Interrupted evidence is retained and never silently declared complete. Request retries create new assessments with at most three attempts; an idempotency key prevents duplicate submissions for identical configurations.

See BACKUP_AND_RECOVERY.md and RELEASE_BLOCKERS.md. Public exposure is not recommended until the listed gates pass.
