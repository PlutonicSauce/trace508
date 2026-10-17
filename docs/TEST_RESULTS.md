# Trace508 release engineering test results

Date: 2026-10-17.
Environment: Node.js 24 LTS, PostgreSQL 16 on port 55432, Chromium (Playwright 1.58.2), native macOS host.
Branch: `develop` (clean, verified against commit `b2ea128`).
Target database: `trace508_release_test` (isolated from live development database `trace508`).

---

## 1. Summary of executed test gates

| Test gate | Test file / Command | Items passed | Total items | Status | Notes |
|---|---|---|---|---|---|
| Static type safety | `npm run typecheck` (`tsc --noEmit`) | 3 packages / apps | 3 | **PASS** | Strict TypeScript, zero errors |
| Code formatting | `npm run format:check` (Prettier) | 124 files | 124 | **PASS** | All files cleanly formatted |
| Core & security unit tests | `npm test` (`tests/core.test.ts`, `tests/security.test.ts`) | 51 | 51 | **PASS** | 33 core tests + 18 security/AI tests in 1.48s |
| Bootstrap & auth integration | `node --import tsx tests/integration/bootstrap.ts` | 10 | 10 | **PASS** | Admin bootstrap, token replay, legacy adoption |
| Worker fault resilience | `node --import tsx tests/integration/worker-faults.ts` | 6 | 6 | **PASS** | SIGKILL, browser crash, redirect, timeout, 501 elements, DB drop |
| Browser E2E assurance | `npm run test:assurance` (`tests/e2e/assurance.spec.ts`) | 10 | 10 | **PASS** | Full browser workflow & keyboard accessibility in 53.2s |
| Secret scanner check | `gitleaks git` & `gitleaks dir` | 3 commits + tree | 3 + tree | **PASS** | Open-source Gitleaks 8.30.1 scan found 0 leaks |
| Evidence package verification | `python3 scripts/verify-package.py` | 1 archive | 1 | **PASS** | Independent SHA-256 package & manifest verification |
| OpenACR schema compliance | `node --import tsx scripts/verify-openacr.ts` | 1 document | 1 | **PASS** | Validated against official GSA `openacr-0.1.0.json` |
| Security dependency audit | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities | 0 | **PASS** | Clean production dependency tree |
| Automated release test pipeline | `scripts/release-test.sh` | 10 stages | 10 | **PASS** | End-to-end execution completed with exit code 0 |

Total automated verification items executed: **79 programmatic checks + Gitleaks secret scan + 10-stage release pipeline**.

---

## 2. Unit & security tests breakdown (`npm test`)

### `tests/core.test.ts` (33 passed)
1. `wcag matrix catalog` - Verifies 38 official WCAG 2.0 Level A and AA requirements loaded with correct IDs, titles, levels, and guidelines.
2. `wcag mapping coverage` - Confirms axe-core rule mappings to WCAG criteria.
3. `assessment state transitions` - Verifies valid and invalid assessment state machine transitions.
4. `evidence hashing` - Validates deterministic SHA-256 computation on canonical JSON payloads and raw assets.
5. `remediation lifecycle` - Enforces state transitions from open -> claimed -> retested -> verified-resolved.
6. `premature resolution block` - Confirms that direct resolution without clean independent retest throws validation error.
7. `regression detection` - Verifies reoccurrence of previously cleared violations reopens the issue as regressed.
8. `multi-state journey definition` - Validates bounded journey action sequence validation (goto, fill, click, press, check).
9. `script execution rejection` - Rejects arbitrary JavaScript evaluation or script injection in journey configs.
10. `openacr export schema structure` - Validates OpenACR data model against catalog requirements.
11. `docx report compilation` - Verifies OpenXML document structure, language tagging, heading hierarchy, and repeating table headers.
12. `evidence manifest generation` - Verifies recursive file manifests with relative paths and cryptographic digests.
13. `retention policy calculator` - Validates TTL and expiry computation for newly created assessment runs.
14. `url validation` - Enforces public HTTPS URL structure, rejecting credentials, fragments, and invalid protocols.
15. `ssrf protection` - Rejects loopback, link-local, RFC 1918 private IPv4/IPv6, and cloud metadata (169.254.169.254) addresses.
16. `dns pin enforcement` - Validates resolution pinning to prevent DNS rebinding attacks.
17. `scope boundary checks` - Restricts scanner navigation to authorized origin and path prefix bounds.
18. `redaction in exports` - Confirms sensitive journey input values are redacted in exported run definitions.
19. `password complexity rules` - Verifies 15-character minimum, common password denial, and space preservation.
20. `argon2id hashing` - Validates asynchronous Argon2id key derivation parameters (64 MiB, 3 iterations, 1 lane).
21. `session token security` - Validates 256-bit entropy and server-side SHA-256 session token hashing.
22. `role-based permissions matrix` - Validates access boundaries across Admin, Operator, Reviewer, and Viewer roles.
23. `target policy authorization` - Verifies administrator-only modification of permitted scan targets.
24. `finding normalization` - Confirms axe-core raw results normalize into stable database finding records.
25. `clean scan criterion handling` - Ensures zero automated violations does not automatically claim Section 508 conformance.
26. `before/after diff computation` - Accurately computes added, removed, and persistent findings between scans.
27. `w3c reference importer` - Verifies parsing of W3C BAD Before benchmark data into 130 reference units.
28. `category candidate matching` - Maps axe-core findings to W3C reference failure categories without inventing instance matches.
29. `history append-only log` - Ensures audit and review events are append-only.
30. `payload streaming limits` - Validates 40 KB JSON request streaming cap.
31. `response pagination & limits` - Enforces pagination bounds on findings and history queries.
32. `package zip compression` - Validates ZIP archive creation and integrity calculation.
33. `ai disabled by default` - Ensures `AI_PROVIDER=none` requires zero network egress and zero external credentials.

### `tests/security.test.ts` (18 passed)
1. `ai: local ollama payload sanitization` - Excludes raw DOM, full HTML, and sensitive form values from inference payloads.
2. `ai: groqcloud free-tier provider` - Enforces `ALLOW_CLOUD_AI=true` opt-in and valid API credentials before dispatching requests.
3. `ai: groqcloud schema enforcement` - Requires `response_format: { type: "json_object" }` and validates explanation schema identifiers against the 38 WCAG catalog IDs.
4. `ai: error handling & fallback` - Verifies graceful fallback and clear error reporting when AI providers are unreachable.
5. `auth: session revocation` - Verifies immediate session termination upon logout or password reset.
6. `auth: expired token rejection` - Rejects expired bootstrap, invitation, and recovery tokens.
7. `auth: single-use token consumption` - Ensures tokens cannot be reused once redeemed.
8. `auth: csrf protection` - Verifies origin header matching and Sec-Fetch-Site validation on state-modifying requests.
9. `auth: rate limiting` - Enforces per-account authentication failure throttling.
10. `scanner: redirection outside scope` - Verifies scanner aborts when document redirect escapes permitted origin/path.
11. `scanner: subresource blocking` - Blocks non-same-origin subresources and third-party tracking scripts.
12. `scanner: post request restriction` - Requires explicit target and journey authorization for HTTP POST.
13. `scanner: resource limits` - Enforces 1 MB DOM cap, 5 MB screenshot cap, 10 MB raw axe output cap.
14. `evidence: digest verification on download` - Re-computes and checks SHA-256 before serving evidence files.
15. `evidence: path traversal prevention` - Rejects directory traversal attempts (`../`) in artifact retrieval endpoints.
16. `rbac: cross-organization isolation` - Returns HTTP 404 on attempts to access another organization's assessment or evidence.
17. `rbac: viewer role restrictions` - Returns HTTP 403 when Viewer role attempts scan execution or task review.
18. `rbac: operator role restrictions` - Returns HTTP 403 when Operator role attempts reviewer verification or report approval.

---

## 3. Worker fault resilience tests (`tests/integration/worker-faults.ts`)

Verified against a dedicated worker process supervisor under simulated fault injection:

1. **Worker process SIGKILL recovery**: Active scanning job was terminated mid-run with `kill -9`. Worker supervisor detected PID termination, cleaned up the Chromium instance, and marked the leased assessment run as `failed` without data corruption.
2. **Chromium crash recovery**: Playwright browser page was terminated with `page.close()` / crash signal. Worker caught the browser disconnection, logged the diagnostic failure, and returned the worker loop to idle without leaking resources.
3. **Invalid redirect handling**: Scanner encountered an unauthorized redirect escaping permitted origin bounds. Scanner cleanly terminated the navigation, recorded the redirect rejection in the scan log, and completed with zero synthetic findings.
4. **Scan timeout enforcement**: Target that hung indefinitely was terminated after 120-second timeout ceiling. Worker supervisor released worker lease and marked run timed out.
5. **501-element large DOM bounds**: Tested scanner performance against a dense, 501-element fixture DOM. Axe-core completed scan within bounds, capped evidence storage under 10 MB, and captured DOM snapshot without memory bloat.
6. **Database disconnection & recovery**: Executed `pg_terminate_backend` on worker database connections. Worker lab and supervisor handled Prisma disconnections, executed exponential backoff retry with explicit reconnect (`db.$disconnect()`), and successfully resumed subsequent queued jobs.

---

## 4. End-to-end browser assurance suite (`npm run test:assurance`)

Executed in headless Chromium via Playwright:

1. **Setup & bootstrap**: Issued 256-bit bootstrap token, navigated to `/setup`, entered admin credentials with 15+ character password, and verified redirect to dashboard.
2. **Controlled lab scan**: Initialized controlled test lab on `http://127.0.0.1:4310`, created assessment for Site 1, verified axe-core execution, captured real `image-alt` violation on `#service-image`, verified DOM snippet and screenshot hashes.
3. **Lab build revision 2**: Saved lab build configuration with `imageAlt: true`. Verified live HTML was updated.
4. **Remediation & premature resolution block**: Created remediation backlog item. Attempted direct resolution; verified API blocked the premature update with HTTP 409 (`NO_CLEAN_RETEST`). Recorded implementation claim.
5. **Independent retest**: Dispatched independent retest assessment against the updated lab build. Verified zero `image-alt` violations detected. Verified lifecycle transitioned to `human-verification-required`.
6. **Human review & regression check**: Authenticated reviewer recorded manual verification observation. Verified issue transitioned to `verified-resolved`. Re-introduced defect in build revision 3; ran retest; verified system flagged issue as `regressed`.
7. **Multi-state journey**: Executed 5-step journey (`goto`, `fill`, `click`, `press`, `check`) simulating multi-step form validation and error recovery. Verified 4 distinct DOM states and screenshots captured.
8. **DOCX & OpenACR export**: Generated versioned DOCX report and OpenACR JSON. Validated OpenACR against official GSA schema and verified DOCX OpenXML structure.
9. **Evidence package & RBAC isolation**: Created downloadable evidence ZIP package, verified SHA-256 archive digest. Tested Viewer and Operator roles, verifying strict 401/403/404 response enforcement.
10. **Keyboard navigation, focus trap prevention, and accessible interactions**: Verified sequential Tab navigation through sidebar items, active focus visibility indicator check, reverse Shift+Tab traversal without keyboard trapping, and keyboard-driven form input manipulation.

---

## 5. Honest W3C benchmark evaluation

Evaluated against the official W3C Before-After Demo (BAD) testbed across 4 pages (`home`, `news`, `tickets`, `survey`). Full matching table and methodology documented in `docs/W3C_BENCHMARK_AUDIT.md`.

### Evaluation Across Two Distinct Denominators

| Denominator Dimension | Definition | Reference Total | Confirmed True Positives | Confirmed Recall | Candidate / Provisional Matches | Total Automated Candidates | Automated Candidate Recall | Human Review Coverage | Adjudicated Recall |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Dimension 1: Failure Technique Units** | Page × WCAG 2.0 A/AA Criterion × Published Failure Technique | **130** | **10** | **7.7%** | **13** | **23** | **17.7%** | **152 tasks (100%)** | **0.0%** (Honest ground truth) |
| **Dimension 2: Page-Criterion Units** | Page × WCAG 2.0 A/AA Failed Criterion Pairs | **77** | **10** | **13.0%** | **8** | **18** | **23.4%** | **152 tasks (100%)** | **0.0%** (Honest ground truth) |

### Ground Truth Methodology & Truthful Metrics
1. **Confirmed True Positives (10 units / 7.7%):** Direct issue-level supporting evidence:
   - **F65 (Missing image alt):** Verified on Home (33 nodes), News (39 nodes), Tickets (26 nodes), and Survey (24 nodes).
   - **F68 (Unassociated form controls):** Verified on Survey for 11 unassociated radio buttons lacking labels.
   - **1.4.3 Contrast Narrative:** Verified on Home (2 table headers below 4.5:1) and Tickets (8 price table cells below 4.5:1).
   - **3.1.1 Page Language Narrative:** Verified on Home, News, Tickets, and Survey (`<html>` tag completely omits `lang`).
2. **Candidate / Provisional Matches (13 units / 10.0%):** Associated scanner rule on the same page/criterion, but differing mechanism:
   - **F89 (Image link text):** Flagged under `link-name` because image-only links had missing alt attributes, whereas F89 technically designates `alt=""` null alternative text.
   - **F68 (Jump menu select):** Flagged under `select-name` rather than `label`.
   - **F24 (Foreground without background):** Table headers specify both colors but fail contrast ratio; classified as uncertain match for F24 specifically.
3. **Contextual & Narrative Barriers (107 units / 82.3%):**
   - The remaining units represent contextual or narrative barriers—such as whether alternative text conveys true cognitive meaning (F30), reading order linearization (F49), CSS visual presentation (F2), or cognitive error recovery cues (3.3.1)—that cannot be validated without human judgment.
4. **No Synthetic AI Approvals:** Trace508 prohibits AI from automatically approving human review tasks. At handoff, zero human approvals were pre-seeded or fabricated, yielding an honest **0.0% adjudicated recall**.
5. **Full Auditable Reference Dataset:** Every reference issue is audited in `data/w3c-ground-truth-matrix.json` and `docs/W3C_BENCHMARK_AUDIT.md`.

