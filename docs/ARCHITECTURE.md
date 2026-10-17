> Release update: this earlier implementation report is superseded for readiness by PRODUCTION_READINESS.md, SECURITY_REVIEW.md and TEST_RESULTS.md. Passwords/bootstrap, worker leases/supervision, AI providers and deployment configuration have changed. Historical measurements remain labeled below.

# Trace508 assurance architecture

Next.js 16/React 19 provide the authenticated UI and API. Prisma/PostgreSQL own persistent project scope, target policies, accounts, sessions, jobs, original evidence, reviewer decisions, remediation events and report versions. A separately executable Playwright/axe worker claims queued assessments through PostgreSQL SKIP LOCKED. A separate optional fixture server produces controlled websites from saved lab revisions.

## Assurance flow

An authenticated operator selects a permitted target and scope or journey. The API snapshots that configuration and persists a queued assessment. The worker revalidates the target, resolves public DNS, pins the destination hostname, constrains all browser requests, executes actual interactions and scans requested states with WCAG 2.0 A/AA tags. It saves axe JSON, original DOM, screenshots, hashes, browser/scanner versions, timestamps and execution results.

Findings associate observed rule/page/state failures with requirements through a versioned mapping. Thirty-eight criterion tasks per scanned state keep manual coverage obligations visible. Finding validation and criterion conformance remain separate. Authenticated reviewer decisions append rather than overwrite prior decisions.

Remediation claims produce history but cannot resolve an issue. A retest queues a separate assessment using the original target/journey/scope, preserving both versions. Reconciliation requires corresponding URL/state and rule outcome. Clean conclusive rule results require human issue verification; incomplete/failed tests cannot resolve an issue. Subsequent detection reopens a previously cleared issue as a regression. A clean automated result or verified issue never automatically approves the whole criterion.

## Authentication and project ownership

Organization members have viewer/operator/reviewer/admin roles. Session cookies are HttpOnly, SameSite Strict, eight-hour expiry and Secure when APP_ORIGIN is HTTPS. Database sessions store hashed random tokens. Passwords use salted scrypt. Sign-in failures have a persisted per-account throttle. Administrators can disable accounts and revoke sessions.

Sessions hold an active project. Server-side ownership checks apply to assessment, page evidence, report, package, finding, review, remediation and comparison identifiers. Project switching and member management enforce organization scope. Roles apply across projects in the member's organization; this release does not claim fine-grained per-project membership or SSO.

## Evidence integrity and living drafts

New evidence uses sorted-key canonical JSON SHA-256; legacy records retain their original hash scheme. Screenshot hashes cover file bytes. Independent packages contain source JSON/DOM/screenshots, requirements, decisions and lifecycle state, with a per-file manifest and separate archive digest. Hashes are not signatures. Database administrators and storage operators can still alter local records; external tamper-proof storage is not implemented.

Reports snapshot current persisted evidence and reviewer conclusions. Retests share a report series with their original assessment. Version creation is serialized, preserving prior snapshots and recording finding/evidence/criterion changes. DOCX remains an incomplete working draft where evaluation is incomplete. OpenACR exports validate against the retained official GSA 0.1.0 schema and catalog identifiers. Unresolved criteria omit adherence rather than inventing a passing or inapplicable claim. Schema validity is distinct from complete VPAT/Section 508 ratification.

## Scan and content boundaries

Administrator-permitted public HTTPS origins and path prefixes are stored as Target policies. Each scan snapshots its policy, validates public DNS and pins the resolved IPv4 hostname in Chromium. Redirected documents must stay in scope. Same-origin resources only, no service workers, WebSockets or downloads. Only GET/HEAD by default; document POST needs both target and journey consent. At most four explicit initial URLs, twelve journey steps, 400 resource requests and 120 seconds per assessment. DOM evidence is capped at one megabyte per state.

The optional local lab is the only private-address exception: ENABLE_LAB=true, exact configured loopback origin, generated /site/<id> prefix, persisted controlled build revisions. It cannot authorize arbitrary localhost services. External content cannot extend the target policy or execute arbitrary scanner-side JavaScript.

React escapes untrusted evidence. Gemini receives minimized bounded findings without HTML only after project-level consent, never browser-visible keys. Zod validates structured outputs and exact evidence/finding IDs. AI has no write path to scanner findings or conformance approvals.

## Operational boundaries

Native processes were executed; Docker Compose is supplied with shared persistent volumes and worker resource limits but was not run because the daemon was unavailable. One worker replica is the supported deployment. Watchdog recovery marks stale work failed; it does not overwrite partial evidence. Retention is an explicit operator purge with a dry-run and UI deletion requires typed confirmation. No federal security authorization or production certification is claimed.
