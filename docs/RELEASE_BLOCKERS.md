# Release blockers

Verdict: **Do not recommend operational deployment yet.** A functioning native candidate and passing functional tests do not close infrastructure, identity or independent security gates.

| Priority | Status | Blocker | Required closure evidence |
|---|---|---|---|
| P0 | BLOCKED | Clean container build exhausted host disk while installing Chromium (ENOSPC/EIO); Docker restart timed out | Host with sufficient free disk; clean image build; successful startup/migration/seed/browser; capture image digest and logs |
| P0 | NOT VERIFIED | Separate-browser network egress, Linux sandbox, container CPU/memory/PID/read-only controls | Test actual private-IP/metadata/redirect/subresource denial and direct egress failure from running containers; browser has no secrets/DB route/mount |
| P1 | NOT VERIFIED | Real HTTPS, certificate trust/renewal, security headers through proxy and container secret readability | Clean deployment on intended domain; successful secure-cookie/login/export and header checks without insecure TLS bypass |
| P1 | NOT VERIFIED | Container volume backup/restore and restart recovery | Fresh second deployment restored from database+artifact backup; independent hashes/counts and new scan |
| P1 | NOT IMPLEMENTED | MFA/SSO, verified email and deployment identity assurance | Agency/customer-approved identity integration, enrollment/recovery/role/revocation tests |
| P1 | NOT IMPLEMENTED | Compromised-password corpus/service and distributed abuse prevention | Approved blocklist and limits tested under expected topology; current small common-secret list is insufficient to claim comprehensive NIST adherence |
| P1 | NOT VERIFIED | Independent security assessment, storage encryption/key custody, log retention/alerts | Reviewed findings resolved; encryption/backup/key/log operational evidence; no unsupported authorization claims |
| P2 | NOT VERIFIED | Representative screen-reader evaluation and exhaustive manual frontend/Word accessibility | Actual assistive technology tester records and resolved findings; automated axe/keyboard checks are partial |
| P2 | NOT VERIFIED | Long-duration/large-findings/near-limit archives and exhaustion workloads | Repeated sustained runs with RSS/CPU/storage/DB measurements; 4-job load and 501 observed elements are bounded samples |
| P2 | NOT VERIFIED | Live Ollama inference with an installed model | Local model configured and successful schema-valid output under no-cloud policy; contract/outage tests are separate |
| P2 | BLOCKED | ORAP/GAT actual fork integration | Supplied repositories/contracts/access inspected and round-trip tests executed |
| P2 | NOT VERIFIED | CI execution on a clean remote runner | Workflow run links and artifacts; writing a YAML workflow is not a passing CI result |

Full official ACR/VPAT ratification, human criterion evaluations and W3C reference instance adjudication are separate product/evaluation obligations. Neither zero automated violations nor schema-valid OpenACR closes them. No FedRAMP, FIPS validation, ATO, contractual approval or Unissant endorsement is asserted.

Do not work around blockers by disabling the browser sandbox, allowing general private-network scans, inventing human approvals, weakening TLS, removing failed tests, or describing skipped checks as passing.
