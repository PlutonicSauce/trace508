# Trace508 accessibility assurance

Trace508 connects real assessment, preserved evidence, remediation claims, independent retesting, human verification and versioned draft ACRs. It includes authenticated organization accounts, project scope, permitted target policies, multi-state journeys, a separate controlled fixture lab, provenance packages, a remediation/regression lifecycle and schema-validated partial OpenACR drafts.

## Native setup

Use Node.js 24 LTS, npm, PostgreSQL 16 and Chromium dependencies. Run commands from the repository root.

```sh
npm ci
cp .env.example .env
# Configure DATABASE_URL for your PostgreSQL database.
npx playwright install chromium
npm run db:migrate
npm run db:seed
npm run dev
```

In another terminal:

```sh
npm run worker
```

Run `npm run bootstrap:issue` from a trusted server terminal first. If this workspace contains legacy assessments, inspect their ownership and explicitly run `npm run bootstrap:issue -- --adopt-legacy`. Read the protected `.local/bootstrap-token` through your trusted channel, then open http://127.0.0.1:3000 and enter it with your own administrator details and a password of at least 15 characters. The token expires in one hour and can initialize only once. There are no built-in passwords or automatically approved reviewer records. The migration preserves existing real W3C scans in the default project.

Administrators manage permitted targets, projects, retention/AI consent and single-use member invitations/recovery. Operators run scans, journeys and remediation claims. Reviewers can additionally save observations, verify remediation, adjudicate references and export reports. Viewers have read-only access within their organization. Accounts are organization members; all projects in that organization are accessible according to the member's role. The server checks project ownership for every assessment, evidence, report, task and remediation ID.

### Project-local PostgreSQL

This workspace already has `.local/postgres` initialized and running on port 55432. Preserve it and `.local/evidence`, `.local/reports` and `.local/packages` together.

```sh
# For an already initialized workspace:
pg_ctl -D "$PWD/.local/postgres" -l "$PWD/.local/postgres.log" -o "-h 127.0.0.1 -p 55432 -k $PWD/.local/socket" start
# Stop:
pg_ctl -D "$PWD/.local/postgres" stop
```

For a new native database only:

```sh
mkdir -p .local/socket
initdb -D "$PWD/.local/postgres" -A trust -U trace508
pg_ctl -D "$PWD/.local/postgres" -l "$PWD/.local/postgres.log" -o "-h 127.0.0.1 -p 55432 -k $PWD/.local/socket" start
createdb -h 127.0.0.1 -p 55432 -U trace508 trace508
```

Trust authentication is a local development convenience, not a government deployment control. Use authenticated database roles in other environments.

## Repeat the complete assurance loop without source edits

1. In **Project & access**, create an isolated test fixture project and select it in the top bar.
2. Set `ENABLE_LAB=true` in the server/worker environment. Keep the exact `LAB_ORIGIN=http://127.0.0.1:4310`. Restart web/worker after changing environment variables.
3. Run `npm run lab` in a third terminal. The native lab binds only to loopback.
4. In **Controlled test lab**, initialize the two controlled websites. Assess the first home's broken image or the second site's form. These are real HTML websites, visibly labeled as fixtures.
5. Inspect the actual finding, source DOM, selector, screenshot, hashes and requirement association. Generate draft report version 1 if desired.
6. Save a new lab build revision with image alternative text or a form label enabled. Open the actual lab website to inspect the changed HTML. This does not edit existing scan evidence.
7. From the original **Remediation backlog**, record a proposal/implementation claim, then **Run independent retest**. A new assessment runs against the changed website. Its corresponding rule/page/state must have a conclusive result before the issue can reach human verification.
8. Use **Return to original issue lifecycle** from Scan activity. A disappearing violation becomes **Human verification required**, never automatically verified resolved or WCAG Supports.
9. A reviewer records an actual manual observation to verify the issue. Criterion-level decisions remain separate. Generate the next draft report from the retest assessment; its history shows evidence changes and keeps prior versions.
10. Reintroduce a lab defect and retest again to observe regression reopening. All original observations and prior verification events remain available.

The lab is the explicit, bounded exception to internal-network blocking. No general localhost or private-network scan option exists. Fixture build configuration and revision history are persisted. Intentional defects are never inserted as scanner findings.

## New targets and user journeys

In **Project & access**, an administrator registers an authorized public HTTPS origin and permitted path prefix. This requires no target-specific scanner code. Each destination is revalidated and DNS-pinned when scanning; redirected documents must stay within the permitted origin/path. Only same-origin resources load. Third-party/CDN content can be blocked, so scope limitations must be reviewed.

**New assessment** supports a registered target, a starting URL and up to four explicitly supplied URLs. The four-page W3C preset remains available. No unrestricted crawler is enabled.

In **Journey assurance**, create immutable definitions using only `goto`, `fill`, `click`, `press` and `check`. Each step can trigger a real scan of the resulting browser state. There is no arbitrary JavaScript/evaluate action. Form submissions require both target-policy permission and explicit journey permission. Keep secrets and personal information out of journey inputs. Values remain private in the stored definition; exported run configuration redacts them. Source DOM and screenshots may still contain entered content and must be handled as sensitive.

## Evidence and reports

- Findings and node evidence originate from real axe WCAG 2.0 A/AA execution. Page states also retain raw axe JSON, original DOM and screenshots.
- Scan records include configuration, exact scope, axe/Playwright/Chromium versions, timestamps and failures.
- **Evidence-to-Requirement Integrity**: Server-side validation strictly enforces that automated scanner findings can only justify criteria they map to (e.g. color-contrast evidence cannot justify image alternative-text WCAG 1.1.1 decisions). Unsupported submissions are rejected with HTTP 400 `EVIDENCE_CRITERION_MISMATCH`.
- **Cryptographic Observations**: Qualified human observations require documented test steps, tools and results (minimum 30 characters) and generate permanent evidence records with canonical JSON SHA-256 hashing (`canonical-json-sha256-v1`).
- **Report Integrity Dashboard** (`/?view=integrity`): Visualizes validated conformance claims, blocked assertions, pending reviews and the preserved audit log of historical invalidations.
- **ACR reports** generates DOCX snapshots, evidence manifests and partial OpenACR JSON validated against the retained official GSA `openacr-0.1.0.json` schema and WCAG 2.0/508 catalog identifiers.
- Unresolved OpenACR criteria and criteria with integrity violations omit adherence fields. Schema validity does not imply complete catalog coverage, conformance, official VPAT ratification or procurement readiness. Additional Section 508 chapter applicability remains unresolved.
- Report versions share a series across the original assessment and its retests. Changes list added/removed rule/page/state findings, new evidence IDs and changed criterion conclusions.
- **Create evidence package** produces an independent ZIP with source files, screenshots, requirements, decisions and lifecycle data. Download its separate SHA-256 digest. These are hashes, not cryptographic signatures.

```sh
python3 scripts/verify-package.py /path/to/package.zip expected_archive_sha256
```

## Retention and recovery

Administrators can permanently delete a terminal assessment from **Assessment history** by typing its full ID. This deletes its database evidence, decisions, reports and file artifacts, and leaves a project deletion audit event. Stop/cancel active work first. Deletion is per assessment, not an automatic deletion of its entire retest lineage.

Retention days apply to newly created assessments; legacy records without an expiry are preserved. The explicit trusted operator command lists expired terminal records before purging:

```sh
npm run retention:purge
npm run retention:purge -- --confirm-expired
```

Jobs persist in PostgreSQL. Restart the worker to pick up queued work. Leased running/preparing jobs with no valid owner and no progress for three minutes are marked failed; interrupted runs are not declared successful or silently overwritten. Explicit retries create a new assessment and stop after three attempts; Idempotency-Key protects repeated API submissions. See [operations and recovery](docs/OPERATIONS.md).

## Configuration and deployment

AI defaults to `AI_PROVIDER=none`. Use `AI_PROVIDER=ollama` and an installed local model for local inference. Cloud requests additionally require `ALLOW_CLOUD_AI=true`, credentials and administrator project consent; no free-tier billing guarantee is claimed. See `.env.example`. `GEMINI_API_KEY` stays on the server, and the project must explicitly consent before evidence can be sent externally. HTML is excluded from the Gemini payload. The key is not required for deterministic scans/remediation guidance.

```sh
npm run build
npm run start
# Or, with Docker running:
# Set HTTPS APP_ORIGIN, SITE_ADDRESS and generate protected secrets first.
# See docs/DEPLOYMENT.md before exposing any service.
docker compose up --build
```

Compose runs PostgreSQL, migration, web and one worker with shared artifact storage. It includes worker resource limits. The release container build was attempted after starting Docker and failed from host disk exhaustion installing Chromium. Startup, network isolation and HTTPS remain blocked, not passed. See docs/DEPLOYMENT.md. The native controlled lab is a separate development/test facility and is not enabled in Compose. Do not change its loopback exception into a broad container-network bypass.

## Verification

With native PostgreSQL, web, worker and the enabled controlled lab running:

```sh
npm run typecheck
npm test
npm run build
npm run test:assurance
npm run format:check
```

Release tests require a separate DATABASE_URL ending in `_release_test`; they refuse the live workspace database. `scripts/release-test.sh` reproduces the application gates on a prepared native host. The assurance suite creates a separate fixture organization/project and temporary authenticated accounts. It executes real browser scans and real lab HTML revisions; saves clearly labeled fixture reviewer actions; tests independent retests, human gates, regression, journeys, schema-valid reports/packages, role enforcement, project isolation, unsafe target rejection, process restart persistence and accessibility. It deletes its fixture records afterward. It never impersonates a human reviewer in a live project.

`npm run benchmark` evaluates the earliest completed W3C Before/After pair. W3C reference failures remain benchmark data, never scan findings. No 90% issue discovery or 30% triage-time claim is made.

[Verification report](docs/VERIFICATION_REPORT.md) · [Architecture](docs/ARCHITECTURE.md) · [Limitations](docs/KNOWN_LIMITATIONS.md) · [Unissant alignment](docs/UNISSANT_ALIGNMENT.md)

## Release candidate verdict

Operational deployment is not recommended yet. Read [production readiness](docs/PRODUCTION_READINESS.md), [test results](docs/TEST_RESULTS.md), [security review](docs/SECURITY_REVIEW.md), [threat model](docs/THREAT_MODEL.md), [deployment](docs/DEPLOYMENT.md), [backup/recovery](docs/BACKUP_AND_RECOVERY.md) and [release blockers](docs/RELEASE_BLOCKERS.md). CI configuration exists, but its remote execution is not claimed.
