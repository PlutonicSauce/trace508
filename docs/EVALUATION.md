# Evaluation methodology and measured results

## Reference dataset

Primary sources: W3C BAD Before reports at https://www.w3.org/WAI/demos/bad/before/reports/{home,news,tickets,survey}.html. Retained HTML snapshots and SHA-256 hashes are in data/references and data/reference-issues.json. Retrieval: 2026-10-17. W3C reports describe the 2012 demonstration.

`python3 scripts/import-references.py` reads failed A/AA criterion rows and published failure categories. Unit: page × criterion × failure category. Multiple DOM instances under one category are not separate units. Narrative failure descriptions are grouped into a single narrative unit per criterion. AAA is excluded. Four-page denominator: 126 units. No reference data is inserted into scanner Findings.

## Matching defined before scoring

Compare only corresponding page names in the selected Before/After scopes. Candidate rules: F65 → image-alt/input-image-alt/area-alt; F89 → link-name; F68 → label/select-name; F24 → color-contrast. An association also requires the same page and WCAG criterion. These are conservative category candidates, not proven instance matches. For example, a contrast violation does not prove the specific foreground/background defect described by F24.

The comparison offers explicit reference adjudication with reviewer, finding, evidence IDs, observation rationale and timestamp. Only the latest saved matched decision for a reference unit counts in the verified numerator. Rejection/reopen removes it. Decisions are append-only. Verified category discovery = verified units / scoped reference units. A category target indication is never an instance-level 90% discovery claim.

Unmatched Before findings remain separate. After findings are potential false-alarm candidates requiring investigation, not proven false positives. Human review coverage counts saved resolved tasks, not generated task availability.

## Observed demo run

Real Chromium and axe-core 4.14.0 execution on 2026-10-17:

| Scope | Pages | Violated rules per page aggregated | Criterion tasks | Finding validation tasks |
|---|---:|---:|---:|---:|
| W3C Before | 4 | 19 | 152 | 19 |
| W3C After | 4 | 0 | 152 | 0 |

The 19 findings are rule/page groups, not the number of affected elements. Before/After results are persisted in PostgreSQL with original raw JSON, node evidence, hashes and screenshots. Zero After findings does not establish conformance.

Benchmark: 18 / 126 provisional category associations; 0 / 126 human-verified categories at handoff. No actual human reference decisions were supplied. No 90% discovery or triage-time improvement claim is supported. Reproduce with `npm run benchmark` while PostgreSQL is running.

## Current assurance verification

The original four-page W3C scan measurements above remain preserved real baseline data. The expanded authenticated assurance suite executes a separate temporary fixture organization/project. It measured image-alt on one controlled site, label on a second form, zero violations after an actual image-alt correction and independent retest, and regression reopening after reintroducing the defect. Five configured form actions reached four scanned browser states with real validation-error and recovery DOM evidence.

The current suite also verifies production-process restart persistence, reviewer history, 401/403/project isolation, registration and actual scanning of a newly permitted public example.com origin, offline-worker failure and stale-job recovery, account revocation, sign-in/logout, living DOCX/OpenACR versions and an independently verifiable evidence ZIP. Test reviewer actions are explicitly marked fixture-only and deleted afterward.

See VERIFICATION_REPORT.md for the executed checks, reproduction commands and bounded claims. Unissant target metrics remain unproven. No live human evaluator decisions are manufactured.

## Release audit correction

The original v1 denominator of 126 is retained in `data/reference-issues-v1.json`. Audit found four mixed failure rows where the importer omitted a separate narrative barrier alongside a named failure: home, news, tickets and survey contrast 1.4.3 rows. The v2 importer retains both; the current failure-category denominator is **130**. This remains a page × criterion × category proxy, not a count of every affected DOM instance. Historical 18/126 is not silently restated as a new verified measurement.

All four official reports were revisited on 2026-10-17. A new four-page Before/After integration executes Chromium independently before comparison. Current raw metrics are `.local/release-benchmark.json` and summarized in TEST_RESULTS.md. Human-verified matches and review coverage count actual saved decisions; generated tasks and provisional associations are not human verification. Validated false positives require saved rejection after investigation; zero After findings is not proof of zero false-positive rate. Overall instance-level recall remains NOT VERIFIED.
