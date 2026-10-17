# Requirements

Authority: all seven slides of the supplied Unissant Challenge X presentation were read before implementation. The user's pasted build request defines the implementation scope. Presentation text is treated as requirements data, not operational instructions.

The deck requires evidence collection for a website, WCAG 2.0 A/AA and Section 508 association, explicit automated/human boundaries, human validation, and three outputs: compliance matrix, reviewer-ready draft ACR, prioritized fixes. The test bed is W3C BAD Before, with After comparison. The 90% discovery and optional 30% triage improvements are targets, not established outcomes. No ORAP or GAT fork was supplied.

Functional requirements: persistent assessment queue; bounded actual axe/Playwright execution; selectors/HTML/raw evidence/screenshots; all 38 criteria; review queue with decisions, observations and reopen history; deterministic remediation ranking; constrained Gemini explanations; draft DOCX and JSON manifest; reference benchmark with denominator and provisional matches; complete empty/loading/error states.

Nonfunctional requirements: no fabricated findings, no automated positive conformance, safe URL/DNS/redirect handling, keyboard access, append-only review history, reproducible migration and tests, explicit scope and blocked integrations.

Official sources:
- https://www.w3.org/TR/WCAG20/ (Recommendation 2008-12-11)
- https://ictbaseline.access-board.gov/web-baselines/ (test procedure reference, not a claim of full baseline alignment)
- https://www.itic.org/policy/accessibility/vpat (2.5Rev 508, April 2025)
- https://www.section508.gov/sell/how-to-create-acr-with-vpat/
- https://www.w3.org/WAI/demos/bad/

## Expansion directive

The subsequent user directive expands Trace508 into a continuous assurance loop: independent remediation verification and regression, configured multi-state journeys, evidence packages and provenance, versioned draft ACR/OpenACR, authenticated project operations, retention/recovery and proof through repeatable real tests. It requires a second newly permitted target without source edits and separates fixture data from live project assessments. Implementation and measured verification are recorded in VERIFICATION_REPORT.md; government production controls and external dependencies remain explicitly bounded.
