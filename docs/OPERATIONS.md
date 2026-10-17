> Release update: this earlier implementation report is superseded for readiness by PRODUCTION_READINESS.md, SECURITY_REVIEW.md and TEST_RESULTS.md. Passwords/bootstrap, worker leases/supervision, AI providers and deployment configuration have changed. Historical measurements remain labeled below.

# Operations and recovery

## Startup and secrets

Use Node 24 LTS, PostgreSQL 16, Chromium and separate web/worker processes. Complete initial administrator setup on loopback before any remote exposure. Use unique administrator credentials and add least-privilege accounts. Disable compromised accounts to revoke all their sessions. Sessions last eight hours and store only a token hash in PostgreSQL. Passwords use salted scrypt. Native bootstrap has no SSO or external identity proof.

Serve the application behind HTTPS in a remote environment and set APP_ORIGIN to the exact HTTPS origin. This also enables Secure session cookies. SameSite Strict and Origin checks protect mutations. Do not expose local PostgreSQL trust authentication. Store production database and Gemini secrets in an external secret manager rather than a checked-in environment file. No secret-manager integration is claimed by this release.

## Worker supervision

Run one worker replica. PostgreSQL claims use SKIP LOCKED. Queue admission is capped; scan runtime, resource requests, page scope and journey step counts are bounded. Every page/state updates progress. If a worker terminates, a replacement worker marks stale running/preparing work failed after three minutes, updates the run and records an audit event. The process logs are useful diagnostics, not proof of completed tests. No partial evidence is overwritten. Request a fresh assessment or independent retest after correcting the cause.

Use your service manager or container orchestrator to restart web/worker processes. Compose has a database health check and resource limits, but was not execution-tested here. `/api/health` is public liveness/database reachability; protected `/api/workspace` reports authenticated configuration. An idle worker does not need to fabricate progress or completed work.

## Backups and artifact integrity

Back up PostgreSQL and the shared `.local` artifact tree together. Restore to the same TRACE508_ROOT or migrate stored paths deliberately. Prefer independent evidence ZIPs plus separately retained archive digests for review. Package manifests cover exact file bytes with SHA-256. Source records use canonical-json-sha256-v1 for new evidence; older records retain their legacy scheme. No signing key, signature verification, HSM or externally anchored audit log exists.

## Retention and deletion

New assessments inherit a retention date from their project's current retention-days setting. Existing dates are not silently shortened. The trusted operator CLI defaults to a dry-run list; `--confirm-expired` permanently purges selected expired terminal records. The UI requires typing an assessment ID for individual deletion. The service removes associated source files, screenshots, packages and reports as well as relational records, and preserves a project deletion event.

Database deletion and filesystem deletion do not share a transaction. If a filesystem operation fails after database deletion, inspect the project deletion event and clean orphaned files from the corresponding assessment directory and stored report/package paths. Secure disposal from backups and storage-device remanence require deployment-specific policy.

## Deployment review

Native lab traffic is restricted to the exact configured loopback origin and generated /site/<id> paths, with ENABLE_LAB=true. Leave it disabled in non-test deployments. Public targets require explicit administrator registration, public DNS, pinned Chromium hostname resolution, same-origin request policy, scoped document redirects, no service workers/WebSockets/downloads and explicit submission consent. Further review should include egress firewalls, sandbox enforcement, DNS/redirect adversarial tests, browser patch management, storage encryption, telemetry redaction, SSO/MFA, accessibility testing with assistive technology and agency-specific security controls.

This software has no FedRAMP authorization, federal ATO, security certification or Unissant endorsement.
