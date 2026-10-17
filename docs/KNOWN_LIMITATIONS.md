> Release update: this earlier implementation report is superseded for readiness by PRODUCTION_READINESS.md, SECURITY_REVIEW.md and TEST_RESULTS.md. Passwords/bootstrap, worker leases/supervision, AI providers and deployment configuration have changed. Historical measurements remain labeled below.

# Known limitations and external blockers

## External dependencies

- Gemini backend integration, consent, structured schema, minimized payload and ID validation are implemented. No API key was supplied, so a successful live model response has not been verified. Missing credentials and unsupported IDs/fields are tested.
- Supplied ORAP/GAT forks, access and API contracts remain unavailable. Public MissionWORKS/ORAP/GAT descriptions informed the design; no compatible implementation, signatures, endorsement or successful integration is claimed.
- Docker's daemon is unavailable. Compose has not been executed. Native PostgreSQL, web, worker and the controlled lab are exercised.

## Implemented scope and its limits

- New permitted public HTTPS origins/path prefixes can be registered by administrators without scanner code changes. Same-origin resources only; blocked third-party dependencies may limit fidelity. There is no unrestricted crawler, arbitrary private-network scanning, credential capture, file upload/document assessment or automated assistive technology evaluation.
- Journeys support bounded explicit goto/fill/click/press/check actions and state scans. They cannot run arbitrary JavaScript. Definitions are immutable records; editing/branching workflows, secret-vault bindings and reusable encrypted test data are future work. Values and source evidence may be sensitive even though exported run configuration redacts input values.
- The remediation loop verifies the same rule in the corresponding URL/state, conservatively treating remaining rule violations as still detected. It does not prove a developer's exact source-code change or attribute causality. DOM element movement/new violations may require manual adjudication. Inconclusive/failed scans do not resolve issues.
- Verified resolution requires an authenticated reviewer action and a conclusive independent retest. The application cannot prove a person actually performed the described manual procedure. Test-suite reviewer actions exist only in a clearly isolated fixture project and are removed after tests.
- Report versions and evidence changes are implemented. Exports remain partial working drafts, not completed official VPAT® forms or procurement approval. Additional Section 508 chapters, organization-specific ratification and the full baseline test inventory are not automatically established. OpenACR schema-valid output can still be an incomplete evaluation; unresolved adherence fields are omitted.
- All 38 WCAG 2.0 A/AA criteria create manual tasks per tested state. Automated rule mappings provide partial coverage. They do not establish full criterion conformance, even when the loaded page has zero violations.
- W3C benchmark units remain page × criterion × published failure category, not every individual DOM problem. The 90% issue-discovery and 30% triage-time targets have not been demonstrated. Candidate/verified category matches are not instance-level precision or recall.

## Operational controls still needed for government deployment

- Authentication is local salted-password/session authentication with organization-wide roles. There is no SSO, MFA, password reset/email verification, fine-grained project membership, service-account key lifecycle, advanced abuse prevention or external identity assurance. Bootstrap is intended for a trusted operator on loopback before exposure.
- Run one worker replica. Queue claims are durable/atomic and active retests are constrained, but a distributed global worker concurrency allocator and lease-renewal supervisor are not provided. Native browser runtime/memory isolation is weaker than enforced container/OS quotas. Compose limits are unverified until Docker can run.
- Files and database evidence are immutable through normal application write paths, but are not externally signed, write-once, encrypted by the application or anchored to a tamper-resistant audit service. Hashes detect modification only when compared with a trusted retained digest.
- Retention uses persisted expiry dates and an explicit trusted operator purge, not an implicit background deletion timer. Legacy records without expiry are preserved. Deletion is not atomic across PostgreSQL and the filesystem; orphan cleanup and backup retention need operational controls.
- No FedRAMP, ATO, FIPS cryptographic validation, penetration-test certification, Unissant endorsement or full production readiness is asserted.
- Automated accessibility checks and keyboard tests are bounded verification, not a complete manual screen-reader evaluation. DOCX has language, headings and repeating headers, but no exhaustive Word/assistive-technology certification is claimed.
