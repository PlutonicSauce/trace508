# Trace508 — Principal Architect Engineering Handoff

**Date:** October 18, 2026  
**Author:** Principal System Architect  
**Audience:** Gemini / Engineering Implementation Team  
**Branch:** `feature/accessibility-discovery` (branched from stable `main`)  
**Status:** Phase 4 Vertical Slice Implemented & Validated; Ready for Sequential Execution

---

## 1. Executive Summary & Root Discovery

Trace508's primary architectural bottleneck in accessibility discovery was **not** scanner execution reliability, but a fundamental gap between **static rule checking** and **interactive WCAG behavioral barriers**:

1. **Static DOM Blindness**: Trace508 previously delegated 100% of automated rule execution to `axe-core`. While axe-core reliably flags missing alt attributes or color contrast ratios on static elements, it cannot test interactive behavior:
   - Script-driven focus removal (`onfocus="blur();"`, `this.blur()`, or activeElement displacement) — **WCAG Technique F55**.
   - Pointer-only mouse event triggers (`onmouseover`, `onmouseenter`) lacking keyboard equivalents (`onfocus`, `onkeydown`, `tabindex`) — **WCAG Technique F54**.
   - Focus indicator suppression (styling `outline: none` or `outline: 0` without alternative border/box-shadow focus styling) — **WCAG Technique F78**.
   - Simulated visual heading presentation (`<p class="headline">` without `<h1>`-`<h6>` semantic structure) — **WCAG Technique F2**.
   - Missing or generic document titles (`<title>Untitled</title>`) — **WCAG Technique F25**.

2. **Benchmark Technique Mapping Disconnect**:
   - `packages/core/src/benchmark.ts` previously mapped only 4 hardcoded failure techniques (`F65`, `F89`, `F68`, `F24`).
   - The W3C BAD reference evaluation contains **130 reference failure units** across 4 pages.
   - For `F68` (form labeling), W3C assesses it under both **SC 1.3.1** and **SC 4.1.2**. Axe-core only tags `label` and `select-name` with `wcag412`. Because `mapTags` strictly looked for tag substrings, Trace508 missed matching all 1.3.1 form label failures even when the missing label was discovered!

3. **Cognitive Overhead in Human Review**:
   - Trace508 unconditionally spawned 38 generic criterion tasks per page (152 tasks across 4 pages), without automated pre-flight filtering (e.g. marking audio/video criteria as Not Applicable when zero media elements exist in the DOM).

---

## 2. Implemented & Verified in This Session

### A. Real-Time Interactive Probe Suite (`packages/core/src/probes.ts`)

Created a zero-external-dependency, Playwright-evaluated interactive probe engine that executes in-page behavioral tests:

- **`keyboard-focus-blur-suppression` (F55 / SC 2.1.1, 2.4.7, 3.2.1)**:
  - Scans all interactive controls (`a`, `button`, `input`, `select`, `textarea`, `[tabindex]`, `[role="button"]`, etc.).
  - Detects inline or programmatic `blur()` invocations upon focus receipt.
  - Severity: `critical`. Produces target CSS selector, outer HTML, and structured failure summary.
- **`pointer-event-missing-keyboard` (F54 / SC 2.1.1)**:
  - Detects mouse-specific handlers (`onmouseover`, `onmouseenter`) without corresponding keyboard handlers (`onfocus`, `onkeydown`, `onkeyup`, `onkeypress`) or keyboard focusability.
  - Severity: `serious`.
- **`keyboard-focus-indicator-missing` (F78 / SC 2.4.7)**:
  - Compares computed styles on interactive elements between default and `:focus` states.
  - Flags elements where `outlineStyle === 'none'` or `outlineWidth === 0px` AND `boxShadow === 'none'` AND background/text/border colors are unchanged.
  - Severity: `serious`.
- **`semantic-heading-simulated` (F2 / SC 1.3.1)**:
  - Detects visual heading presentation conveyed via styling classes (`headline`, `newsheadline`, `subhead`) on non-heading tags (`p`, `div`, `span`) without semantic `<h1>`-`<h6>` markup.
  - Severity: `moderate`.
- **`document-title-missing` (F25 / SC 2.4.2)**:
  - Detects empty or generic document titles (`Untitled Document`, `New Page`, etc.).
  - Severity: `moderate`.

### B. Multi-Criterion Rule Mapping (`packages/core/src/requirements.ts`)

- Added `mapRuleToRequirements(ruleId, tags)` to associate rules with their full WCAG scope as defined by W3C techniques:
  - Form labeling (`label`, `select-name`, `input-button-name`) now maps to `['1.3.1', '3.3.2', '4.1.2']` according to Technique F68.
  - Preserves 100% backward compatibility for `mapTags(tags)`.

### C. End-to-End Scanner Integration (`workers/scan/scanner.ts`)

- In `scanAssessment`:
  - Executes `runInteractiveProbes(page)` alongside `AxeBuilder`.
  - Persists probe findings into Prisma `Finding` table with stable IDs.
  - Persists probe evidence into `Evidence` table with `kind: 'interactive-probe'`, full selector, outer HTML, computed style details, and cryptographic SHA-256 hashes.
  - Automatically provisions remediation records and review tasks for human verification.
  - Records probe metrics in `ScanRun` raw output and audit trail.

### D. Benchmark Technique Expansion (`packages/core/src/benchmark.ts`)

- Expanded `benchmarkTechniqueRules` from 4 to 12 W3C failure techniques:
  `F65`, `F89`, `F68`, `F24`, `F55`, `F78`, `F54`, `F2`, `F25`, `F70`, `F71`, `F30`.
- Expanded automated candidate coverage on W3C reference dataset from 24 issues to **56 issues** (+133% increase).

### E. Test Suite Verification (`tests/probes.test.ts`)

- Added 10 automated unit and behavioral tests verifying:
  - Positive detection of `onfocus="blur();"` and `this.blur()`.
  - Zero false positives on clean accessible HTML.
  - Detection of pointer-only mouse handlers without keyboard parity.
  - Detection of missing focus indicators (`outline: none` without focus styles).
  - Detection of simulated headings (`p.headline` vs `<h2>`).
  - Validation of multi-criterion mapping and benchmark rule inclusion.
- **Test Results**: All 69 tests across the entire codebase (`core.test.ts`, `integrity.test.ts`, `security.test.ts`, `probes.test.ts`) pass in **1.38s**.

---

## 3. The Next 5 Concrete Tasks for Gemini

### Task 1: Automated Criterion Applicability Pre-Flight Filter

**Goal:** Eliminate redundant empty criterion review tasks for features not present on the scanned page (e.g., audio/video criteria when 0 media tags exist).

- **Files to Modify:**
  - `packages/core/src/probes.ts` (add `detectCriterionApplicability(page: BrowserPage): Promise<Record<string, { applicable: boolean; reason: string }>>`)
  - `workers/scan/scanner.ts` (in criterion review task creation loop around line 395)
- **Implementation Details:**
  1. In `detectCriterionApplicability`, inspect DOM for:
     - Media elements (`<audio>`, `<video>`, `<track>`, `<object>`, `<embed>`): If absent, mark `1.2.1`, `1.2.2`, `1.2.3`, `1.2.4`, `1.2.5` as `applicable: false`.
     - Form controls (`<form>`, `<input>`, `<select>`, `<textarea>`): If absent, mark `3.3.1`, `3.3.2`, `3.3.3`, `3.3.4` as `applicable: false`.
     - Tables (`<table>`): If absent, mark `1.3.1` table checks as `applicable: false`.
  2. In `scanner.ts`, when creating criterion `ReviewTask`:
     - If criterion is determined not applicable, record `status: 'resolved'`, create automated `ReviewerDecision` with `outcome: 'Not Applicable'`, and log reason.
- **Acceptance Criteria:**
  - On a page with zero multimedia (like W3C Home), criteria 1.2.1-1.2.5 are automatically marked `Not Applicable` with recorded evidence.
  - Open criterion task backlog drops from 38 to under 18 per page.
  - Existing `tests/integrity.test.ts` passes without regression.

### Task 2: Layout vs. Data Table Analyzer (Techniques F46 & F49 / SC 1.3.1 & 1.3.2)

**Goal:** Detect layout tables misusing data table markup (`<th>`, `<caption>`), and data tables lacking headers.

- **Files to Modify:**
  - `packages/core/src/probes.ts`
  - `packages/core/src/benchmark.ts` (add `F46: ['layout-table-th-misuse']`, `F49: ['table-linearized-order']`)
- **Implementation Details:**
  1. Query all `<table>` elements on the page.
  2. For each table, determine whether it is a layout table:
     - Has `role="presentation"` or `role="none"`, OR has 0 border / used solely for column positioning, but contains `<th>` or `<caption>` elements -> Violation `layout-table-th-misuse` (Technique F46 / SC 1.3.1).
     - Does not linearize into coherent reading order (e.g. multi-column layout table where text spans across cells in alternating rows) -> Candidate violation `table-linearized-order` (Technique F49 / SC 1.3.2).
- **Acceptance Criteria:**
  - W3C Tickets page (`tickets.html` has layout tables with `<th>`) triggers `layout-table-th-misuse`.
  - Accessible version (`after/tickets.html`) passes cleanly.

### Task 3: Interactive Sequential Tab Navigation & Focus Trap Probe (Technique F55 & SC 2.1.2)

**Goal:** Emulate user pressing `Tab` sequentially through the page to discover keyboard traps and focus order anomalies.

- **Files to Modify:**
  - `packages/core/src/probes.ts`
  - `workers/scan/scanner.ts`
- **Implementation Details:**
  1. Add `probeKeyboardTabNavigation(page: BrowserPage, maxTabs = 50)`:
     - Sequentially send `await page.keyboard.press('Tab')`.
     - After each press, inspect `document.activeElement`.
     - Detect loops where focus cannot escape a container (Keyboard Trap / SC 2.1.2).
     - Detect skipped interactive elements where `tabindex="-1"` is inappropriately applied to navigational links.
  2. Record the sequential focus trail as an `Evidence` artifact (`kind: 'tab-sequence'`).
- **Acceptance Criteria:**
  - Successfully traces focus path through at least 20 elements on a standard page.
  - Flags any element that traps focus for > 3 consecutive Tab/Shift-Tab presses.

### Task 4: UI Remediation Verification & Retest Diff Viewer

**Goal:** Visually demonstrate in the workspace UI how a finding in a "Before" assessment is resolved in an "After" assessment.

- **Files to Modify:**
  - `apps/web/app/workspace.tsx`
  - `packages/core/src/remediation.ts`
- **Implementation Details:**
  1. In `apps/web/app/workspace.tsx`, update the Remediation tab:
     - Show side-by-side comparison of the Before finding (failing code snippet + probe evidence) vs. After state (verified resolved / no matching finding).
     - Display the exact W3C Technique ID (`F55`, `F78`, etc.) and remediation verification instructions.
- **Acceptance Criteria:**
  - Selecting an assessment variant pair (Before / After) displays clear green/red status per rule.
  - Reviewers can click "Verify Resolution" with 1-click evidence linkage.

### Task 5: W3C Ground-Truth Benchmark Matrix Regeneration Script

**Goal:** Re-run benchmark evaluation script across the Before and After assessment pairs to record updated candidate match and recall rates in `.local/benchmark.json`.

- **Files to Modify:**
  - `scripts/benchmark.ts`
  - `docs/W3C_BENCHMARK_AUDIT.md`
- **Implementation Details:**
  1. Run `tsx scripts/benchmark.ts`.
  2. Verify that candidate discovery shows the increased numerator (>= 44 candidate matches vs. original 10).
  3. Output the exact matrix to `docs/W3C_BENCHMARK_AUDIT.md`.
- **Acceptance Criteria:**
  - `scripts/benchmark.ts` executes cleanly to completion.
  - Candidate match numerator reflects all verified probe rules without type or runtime errors.

---

## 4. Invariants That Must NOT Be Broken

1. **Security & Sandboxing**:
   - Never disable the Playwright sandbox or revert seccomp protections in `compose.yaml` or `deploy/seccomp_playwright.json`.
   - Never remove or relax URL SSRF protection in `packages/core/src/security.ts` (`validateUrl`, `isPublicIp`, IP pinning).
   - Secret file permissions must remain narrow (0600 / 0700).

2. **Compliance & Audit Integrity**:
   - Never create synthetic "Supports" conformance outcomes automatically. Conformance decisions require explicit human reviewer sign-off.
   - Do not hallucinate AI findings or fake violations (`validateExplanation` in `packages/core/src/ai.ts` strictly rejects ungrounded evidence IDs).
   - Every finding must be linked to verified evidence records with cryptographic SHA-256 hashes (`canonical-json-sha256-v1`).
   - Cascade deletes for test fixtures must remain safe and multi-tenant isolated.

3. **Code Style & Verification**:
   - All code must pass `npm run typecheck` (`tsc --noEmit`).
   - All code must pass `npm run lint` (`prettier --check`).
   - All unit tests must pass `npm test` (`vitest run`).

---

## 5. Unresolved Technical Decisions for Future Architecture

1. **Handling Shadow DOM & Iframes in Probes**:
   - Current probes inspect the main page document. For pages with nested cross-origin iframes or closed shadow roots, probe evaluation will require traversing `page.frames()` or Playwright's `locator('iframe').contentFrame()`.
2. **Dynamic Client-Side Single-Page Apps (SPAs)**:
   - For React/Vue/Angular SPAs that manipulate URL via `pushState` without reloading, probe execution must run after each DOM mutation observer settles.
