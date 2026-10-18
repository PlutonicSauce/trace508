# Backup and recovery

Back up PostgreSQL **and** source/report/package volumes during the same maintenance window. Keep backup artifacts private and encrypted through the deployment storage/key-management controls. Credentials and encryption keys require independent protected custody. Test restoration before relying on a backup.

## Compose procedure

Set APP_ORIGIN/SITE_ADDRESS and secret paths as in DEPLOYMENT.md, then run:

```sh
scripts/backup.sh /private/approved/path/trace508-backup
# Copy encrypted backup and SHA256SUMS to independent storage.
```

The script stops web/worker/browser, dumps PostgreSQL custom format, archives the evidence volume, hashes both files, then restarts services through its exit trap. It refuses an existing destination. Hashes detect modification against a trusted manifest; they do not provide signer identity or encryption. Secret rotation, external backup replication, encryption and retention must be configured separately.

Restore into a **fresh empty database and fresh artifact volume**, using the same /app paths and a new Compose project name/host. Do not point restore at existing assessment data:

```sh
CONFIRM_FRESH_RESTORE=YES scripts/restore.sh /private/approved/path/trace508-backup
```

The script checks file digests, refuses any public-schema tables, restores PostgreSQL and extracts artifacts, then starts services. Verify database counts, saved decisions, source hashes, screenshot/report/package downloads, login/role behavior and a fresh controlled scan before reopening access. A missing artifact must fail inspection; do not substitute a new screenshot or source file under an old ID.

**Status:** native PostgreSQL dump/restore with real fixture findings, decisions and report hashes is executed in the acceptance suite. Artifact archive/extraction is a separate explicit assertion in the final suite. Container volume initialization and startup verified in CI test container environment (runs `39099390432`, `39161558167`); off-host cold-site disaster recovery replication remains an operational production task.

## Interrupted work

Queue state and leases are in PostgreSQL. A running/preparing assessment whose updates stop for three minutes and has no live owner lease is failed with its run/steps and an audit event. Original partial evidence remains. No automatic in-place replay overwrites deterministic page/evidence IDs. A retry creates a distinct assessment, links the prior attempt and stops at three attempts. Duplicate Idempotency-Key submissions reuse the same queued record when the configuration matches and reject a changed payload.

The worker resets broken database pools, has bounded connection/query timeouts, and exits on a persistent database stall for supervised restart. The supervisor has a bounded restart budget. Operators must investigate repeated failures and alert on stale leases, failed runs, exhausted retry/restart budgets and evidence-write failures.

## Account recovery and retention

Disable a compromised member to revoke sessions, then issue an administrator-controlled recovery token through a verified trusted channel. A local trusted operator can issue recovery for a lost administrator. Recovery preserves the account/role and decision identity, revokes sessions, and consumes a 24-hour token exactly once. There is no anonymous email reset service or claim of email verification. Existing sessions are revoked by the password-policy upgrade migration; valid passwords shorter than 15 characters require recovery before sign-in.

Retention is explicit: `npm run retention:purge` lists expired terminal assessments; `--confirm-expired` permanently deletes them. UI deletion requires the full assessment ID. Legacy no-expiry records are preserved. Deletion is not atomic across DB/filesystem; investigate audit events and orphan files after partial deletion failure. Packages/reports are snapshots, so retention may remove earlier source lineage; preserve independent archives before deletion if policy requires continued inspectability.

Project admission quota defaults to 512 MB and global source/report/package quota to 2 GB, with 64 MB source-per-assessment and 100 MB uncompressed package limits. These application budgets are not a filesystem quota or substitute for free-disk monitoring. Native PostgreSQL data and build caches require separate capacity planning. This session's ENOSPC incident demonstrates that distinction.
