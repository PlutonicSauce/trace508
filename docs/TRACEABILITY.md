# Requirements traceability

| Requirement | Implementation | Verification |
|---|---|---|
| Real browser scanning | workers/scan/scanner.ts; axe WCAG 2.0 tags | Real four-page Before/After scans; browser acceptance test |
| Original traceable evidence | Evidence model; raw result JSON, nodes, hashes, screenshot | UI evidence detail; raw output and ID assertions |
| WCAG and Section 508 mapping | requirements.ts; FindingRequirement; MAPPING_VERSION | 38-criterion catalog and tag mapping tests |
| Separate automated outcomes from conformance | assessment.ts matrix; criterion and finding tasks | Clean scans remain unresolved; contradiction tests |
| Human review and audit trail | review.ts; append-only ReviewerDecision; AuditEvent | UI reopen/save workflow test; no invented human assessment |
| Prioritized fixes | Remediation; priority(impact); backlog | Deterministic priority tests; actual scan finding remediation checks |
| Draft ACR and evidence package | reports.ts; DOCX, report snapshot, JSON manifest | Download signature; database snapshot/evidence correspondence; DOCX structural checks |
| 90% discovery goal | benchmark.ts; retained W3C evaluations; provisional matching | Reproducible denominator and numerator; target explicitly unproven |
| Few false alarms on After | Real After assessment; candidates remain unadjudicated | Actual scan results, no assumed false positives |
| Constrained AI | ai.ts; Zod; exact IDs; separate system instruction | Missing-key path, hallucinated ID and unauthorized field tests |
| ORAP/GAT reuse | adapters.ts | Unavailable status with exact repository/access blocker |
| Scan safety and failure states | security.ts; pinned DNS; request routes; cancellation | Invalid URL/IP/origin tests; real missing-browser failure test |
| Keyboard and screen-reader access | semantic HTML, labels, focus, skip link, responsive UI | Browser keyboard journey; axe WCAG 2.0 checks across views |

Official ICT Baseline procedures are reference links. This release does not assert full implementation of every baseline test, media-player provision, or all Section 508 chapters. Full official VPAT completion remains a human ratification task.

## Assurance expansion

| Expanded requirement | Implementation | Verification |
|---|---|---|
| Configurable permitted targets | Target policies, project-scoped registration, DNS-pinned worker | New public example.com target executes without source edits; unsafe targets rejected |
| Closed remediation loop | RemediationEvent, RemediationRetest, independent assessment linkage, reviewer gate | Real lab HTML fix, fresh retest, no auto Supports, later regression |
| Multi-state journeys | Journey definitions, JourneyStepRun, state-keyed pages and source evidence | Form navigation, invalid submission, error state, correction and recovery |
| Evidence provenance | Scan configuration/versions, canonical hashes, DOM/PNG sources, independent packages | Hash round trips, original hash preservation, Python ZIP verifier |
| Living reports | Shared report series, serialized versions, evidence differences, DOCX/OpenACR | Before/retest report versions and schema validation |
| Authenticated operations | Salted-password users, hashed sessions, roles, project guards, revocation | 401/403/isolation/forged-identity tests; sign-in and logout flow |
| Retention/recovery | Persisted expiry, explicit purge/deletion, stale-job recovery, project audit | Fixture deletion cleanup; real offline failure; watchdog test; operator procedures |
| Unissant compatibility boundary | Structured requirements and independent evidence, unavailable adapters | Public philosophy reviewed; actual fork integration explicitly blocked |
