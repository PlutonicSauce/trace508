> Release update: this earlier implementation report is superseded for readiness by PRODUCTION_READINESS.md, SECURITY_REVIEW.md and TEST_RESULTS.md. Passwords/bootstrap, worker leases/supervision, AI providers and deployment configuration have changed. Historical measurements remain labeled below.

# Engineering and product verification

Verification date: 2026-10-17. All test data is isolated in a temporary organization/project explicitly marked TEST FIXTURE; temporary accounts, reviewer actions, lab builds, assessments and artifact records are removed afterward. Real production/user decisions are never seeded.

Executed final results: **33 unit tests and 6 end-to-end tests passed**. TypeScript and the production build passed. The native application and PostgreSQL remain available; the initial real W3C evidence is preserved.

## Implemented and executed

| Capability | Evidence from executed verification |
|---|---|
| Two target-specific real assessments | Actual Chromium/axe execution found image-alt on the first controlled site, label on the second form, and no image-alt on the second form. No findings are copied from a fixture JSON. |
| Real build change | The controlled lab appended build revision 2 and served an actual image with alternative text. Browser DOM inspection verified the changed attribute. |
| Independent remediation retest | A new assessment/browser run against revision 2 no longer detected image-alt. The original evidence hash remained unchanged. |
| Human verification gate | Premature resolution without a conclusive independent retest was rejected. Directly setting verified-resolved through the status API was rejected. A labeled fixture reviewer action exercised the permitted post-retest path. |
| Regression | Reintroducing the actual controlled HTML defect in revision 3 and executing another scan reopened the previously cleared issue as regressed. Prior verification history remained available. |
| No automatic conformance | All clean-retest criterion conclusions remained unresolved without separate criterion reviewer decisions. |
| Multi-state journey | Five actual browser actions navigated to a form, entered invalid data, submitted, corrected data and recovered. Four state scans retained DOM evidence showing the actual validation error and recovery message; all five step outcomes persisted. Arbitrary evaluate/script action was rejected. |
| Living ACR | Report versions 1 and 2 preserved snapshots. Version 2 reflected the changed build and removed finding, with prior history retained. Downloaded DOCX ZIP/XML and file digest matched the record. |
| OpenACR | Generated partial draft JSON validates against the retained official GSA OpenACR 0.1.0 schema and the 38 WCAG 2.0/508 catalog identifiers. Unresolved adherence remains omitted. This is schema validity, not full catalog/VPAT completion. |
| Independent evidence package | ZIP content-file digests and archive digest verified. The separate Python verifier validated the content manifest without using the dashboard. Source DOM is present. Hashes are not signatures. |
| Persistent restart | A compiled production Next.js process was started, stopped and started again against the same PostgreSQL records and authenticated session. Original findings and append-only review history remained available. |
| Authentication and roles | Unauthenticated assessment access returned 401. Viewer mutation and operator review/report attempts returned 403. Forged reviewer text was replaced by the authenticated account identity. Cross-organization assessment/evidence access returned 404. |
| New target without source changes | An administrator registered https://example.com/ through the API; a real scan returned that actual tested URL and axe engine output. No target-specific implementation was added. |
| Unsafe targets | Loopback database endpoints, localhost, private/link-local addresses and unapproved origins were rejected; only the explicit bounded fixture policy is exempt. |
| Worker accuracy | Real offline browser navigation resulted in failed assessment/run states and zero invented findings. The running worker's watchdog marked an intentionally stale fixture job/run failed. |
| W3C integration | Separate real Before and After scans completed and the reference benchmark used their results. No 90% discovery claim was made. |
| Interface accessibility | Fully loaded primary views were checked with axe WCAG 2.0 A/AA; skip navigation and narrow viewport bounds were checked. This does not replace manual assistive technology evaluation. |

The test suite is `tests/e2e/assurance.spec.ts`. Reproduce with native PostgreSQL, web, worker, ENABLE_LAB=true and the lab process running. Run `npm run build` before the suite because it performs actual production-process restart checks.

## Verification commands

```sh
npm run typecheck
npm test
npm run build
npm run test:assurance
npm run format:check
python3 scripts/verify-package.py .local/acceptance-evidence.zip "$(cat .local/acceptance-package.sha256)"
```

The detailed current Playwright execution result is `.local/e2e-results.json`; fixture-only measured outcomes are `.local/assurance-measurements.json`. These are test artifacts, not live assessments.

## Partially implemented or blocked

Gemini requires a real API key for live-success verification. ORAP/GAT require the supplied repositories and contracts. Docker/container execution remains unverified because the daemon is unavailable. Human observations in a real project still require an actual authorized person; fixture test actions do not establish production human validation. Additional Section 508 applicability and organizational ratification are required for a completed official VPAT/ACR. SSO/MFA, external signing/tamper-proof evidence, secret-manager integration, production encryption/egress enforcement, full security testing and government authorization are not claimed.
