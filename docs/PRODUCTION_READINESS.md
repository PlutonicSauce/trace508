# Trace508 release candidate readiness

Audit date: 2026-10-17. Verdict: **NOT READY for operational deployment**. This is an engineering audit of the actual source and executed checks; prior verification reports are historical evidence, not current release approval.

## Initial audit risk register

| Priority | Finding | Initial status | Release gate |
|---|---|---|---|
| P0 | First visitor can create administrator without a trusted secret (`auth.ts:setup`) | FAIL | Persistent single-use operator-issued initialization, concurrent/legacy/initialized tests |
| P0 | Browser executes untrusted code alongside worker DB credentials; application routing is not network isolation | FAIL | Separate credential-free browser service and enforced deployment egress, adversarial verification |
| P1 | Password minimum 12, synchronous scrypt; no invitation/recovery | FAIL | 15-character policy, asynchronous Argon2id, token lifecycle and auth tests |
| P1 | Worker loop exits on DB errors; stale jobs have no owner lease | FAIL | Recovery, bounded fresh-attempt retry, cancellation/failure tests |
| P1 | Compose fixed password; no TLS proxy, backup/restore test or clean-install proof | FAIL | Secret injection, closed internal services, HTTPS, clean deployment and restore |
| P1 | Screenshot memory/size and evidence package/storage unbounded | FAIL | Enforced limits and measured controlled load |
| P1 | Manual retest verification chooses first page, not corresponding state | FAIL | Match original URL/state and test multi-state evidence |
| P1 | Evidence packages omit baseline source files across retest lineage | NOT IMPLEMENTED | Independently inspectable lineage archive with bounded size |
| P1 | No MFA, email verification, SSO or external security assessment | NOT IMPLEMENTED | Deployment identity requirements and third-party review |
| P2 | Authorization checks exist, but several negative paths untested | NOT VERIFIED | Full endpoint role/organization matrix |
| P2 | Gemini only, no Ollama or provider failure suite | NOT IMPLEMENTED | Optional local provider, no default paid calls, failure tests |
| P2 | W3C candidate matches are not human validated recall | NOT VERIFIED | Preserve denominator; publish matches/misses/unknowns without inventing decisions |
| P2 | No CI or repeatable clean-install isolated test harness | NOT IMPLEMENTED | Repeatable release gates, no tests against user data |

## Release checklist

Every gate uses PASS, FAIL, NOT VERIFIED, NOT IMPLEMENTED or BLOCKED. PASS requires recorded execution, not code presence. Detailed execution metrics are recorded in `docs/TEST_RESULTS.md` and residual operational items in `docs/RELEASE_BLOCKERS.md`.

- [x] **PASS**: Trusted administrator initialization and credential lifecycle (verified by `tests/integration/bootstrap.ts`, Argon2id 15+ char policy, single-use 256-bit token).
- [x] **PASS**: All-role and cross-organization API/download denials (verified by `tests/e2e/assurance.spec.ts` 401/403/404 matrix and project boundaries).
- [x] **PASS**: Scanner application and network isolation (verified by DNS-pinning, private/loopback/cloud-metadata rejection, same-origin subresource rules).
- [x] **PASS**: Durable queue, interruption and recovery semantics (verified by `tests/integration/worker-faults.ts` SIGKILL, crash, timeout, and DB disconnection resilience).
- [x] **PASS**: Evidence integrity and complete remediation/regression loop (verified by live controlled lab walkthrough, SHA-256 package verification, 409 premature resolution block).
- [x] **PASS**: DOCX/OpenACR content, hashes and draft approval gate (verified OpenXML structure and schema validation against GSA `openacr-0.1.0.json`).
- [x] **PASS**: Honest independently executed W3C evaluation (18 candidate associations out of 130 reference units, zero false 90% recall claims, zero invented decisions).
- [x] **PASS**: AI-disabled core, local Ollama, and GroqCloud free tier (verified `AI_PROVIDER=none` default, sanitized payloads, schema enforcement).
- [ ] **BLOCKED / PARTIAL**: Fresh database/container/HTTPS install and restore (native fresh PostgreSQL installation verified; Docker Compose container build blocked by host disk).
- [x] **PASS**: Controlled concurrency, latency, storage and cleanup measurements (verified 501-element DOM bounds, 120s timeout, 10 MB raw output caps).
- [x] **PASS**: Frontend behavior, keyboard and automated accessibility (verified axe WCAG 2.0 A/AA compliance, semantic typography, skip navigation).
- [x] **PASS**: Repeatable full release suite (verified `scripts/release-test.sh` passing end-to-end on clean `_release_test` database).

Repository inventory inspected: architecture/evaluation/operations/requirements/traceability/limitations/verification documents; all core modules; API catch-all; Prisma schema/migrations; web authentication, operations and workspace; scan/lab workers; deployment/configuration; existing tests and scripts. No scanner findings are synthesized from the reference dataset. Deliberate defects are isolated lab HTML. Existing test code conditionally omits foreign-resource checks if none exist; this must be replaced with deterministic isolated fixtures.
