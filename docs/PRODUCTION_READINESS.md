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

Every gate uses PASS, FAIL, NOT VERIFIED, NOT IMPLEMENTED or BLOCKED. PASS requires recorded execution, not code presence. Final results and residual blockers will be added after implementation in TEST_RESULTS.md and RELEASE_BLOCKERS.md.

- [ ] Trusted administrator initialization and credential lifecycle
- [ ] All-role and cross-organization API/download denials
- [ ] Scanner application and network isolation
- [ ] Durable queue, interruption and recovery semantics
- [ ] Evidence integrity and complete remediation/regression loop
- [ ] DOCX/OpenACR content, hashes and draft approval gate
- [ ] Honest independently executed W3C evaluation
- [ ] AI-disabled core and local provider failure behavior
- [ ] Fresh database/container/HTTPS install and restore
- [ ] Controlled concurrency, latency, storage and cleanup measurements
- [ ] Frontend behavior, keyboard and automated accessibility
- [ ] CI and repeatable full release suite

Repository inventory inspected: architecture/evaluation/operations/requirements/traceability/limitations/verification documents; all core modules; API catch-all; Prisma schema/migrations; web authentication, operations and workspace; scan/lab workers; deployment/configuration; existing tests and scripts. No scanner findings are synthesized from the reference dataset. Deliberate defects are isolated lab HTML. Existing test code conditionally omits foreign-resource checks if none exist; this must be replaced with deterministic isolated fixtures.
