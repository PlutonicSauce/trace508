import type { Page as BrowserPage } from 'playwright';

export interface ProbeNode {
  target: string[];
  html: string;
  failureSummary: string;
  details?: Record<string, unknown>;
}

export interface ProbeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  requirements: string[];
  candidate?: boolean;
  nodes: ProbeNode[];
}

export interface TabSequenceStep {
  step: number;
  selector: string;
  tag: string;
  text: string;
  outline?: string;
  hasLostFocus?: boolean;
}

export interface ProbeResult {
  violations: ProbeViolation[];
  tabSequence: TabSequenceStep[];
  applicability: Record<string, { applicable: boolean; reason: string }>;
}

/**
 * Executes real-time sequential Tab keyboard navigation through interactive controls.
 * Detects keyboard focus traps (SC 2.1.2), focus blur suppression (F55 / SC 2.1.1, 2.4.7, 3.2.1),
 * and focus visibility under real :focus-visible browser activation (F78 / SC 2.4.7).
 */
export async function probeKeyboardNavigation(
  page: BrowserPage,
  maxTabs = 35,
): Promise<{ violations: ProbeViolation[]; tabSequence: TabSequenceStep[] }> {
  const violations: ProbeViolation[] = [];
  const tabSequence: TabSequenceStep[] = [];

  // Ensure __name helper exists on window in case of bundler function naming
  try {
    await page.evaluate('window.__name = function(fn) { return fn; };');
  } catch {
    // ignore
  }

  // Reset focus to document root
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body) {
      try {
        a.blur();
      } catch {
        // no-op
      }
    }
  });

  const missingFocusNodes: ProbeNode[] = [];
  const trapNodes: ProbeNode[] = [];
  const blurSuppressionNodes: ProbeNode[] = [];
  let consecutiveSameCount = 0;
  let lastSelector = '';

  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');

    const stepInfo = await page.evaluate(() => {
      // @ts-ignore
      var __name = (fn: any) => fn;
      const getCssSelector = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 4) {
          let sel = cur.tagName.toLowerCase();
          if (cur.className && typeof cur.className === 'string') {
            const firstClass = cur.className.trim().split(/\s+/)[0];
            if (firstClass && !firstClass.includes(':')) sel += `.${firstClass}`;
          }
          const parent: Element | null = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
            if (siblings.length > 1) {
              const idx = siblings.indexOf(cur) + 1;
              sel += `:nth-of-type(${idx})`;
            }
          }
          parts.unshift(sel);
          cur = parent;
        }
        return parts.join(' > ');
      };

      const el = document.activeElement;
      if (!el || el === document.body) {
        return {
          isBody: true,
          selector: 'body',
          tag: 'BODY',
          text: '',
          html: '',
          outline: '',
          boxShadow: '',
          noOutline: false,
          noShadow: false,
          onfocus: '',
        };
      }

      const style = window.getComputedStyle(el);
      const outlineStyle = style.outlineStyle;
      const outlineW = parseFloat(style.outlineWidth) || 0;
      const boxShadow = style.boxShadow;
      const noOutline = outlineStyle === 'none' || outlineW === 0;
      const noShadow = !boxShadow || boxShadow === 'none' || boxShadow.includes('rgba(0, 0, 0, 0)');

      return {
        isBody: false,
        selector: getCssSelector(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 50),
        html: el.outerHTML.slice(0, 400),
        outline: `${outlineW}px ${outlineStyle} ${style.outlineColor}`,
        boxShadow,
        noOutline,
        noShadow,
        onfocus: el.getAttribute('onfocus') || el.getAttribute('onfocusin') || '',
      };
    });

    if (stepInfo.isBody) {
      if (tabSequence.length > 0 && !tabSequence[tabSequence.length - 1].hasLostFocus) {
        tabSequence.push({
          step: i + 1,
          selector: 'body',
          tag: 'BODY',
          text: '(Focus suppressed or lost to body)',
          hasLostFocus: true,
        });
      }
      continue;
    }

    tabSequence.push({
      step: i + 1,
      selector: stepInfo.selector,
      tag: stepInfo.tag,
      text: stepInfo.text,
      outline: stepInfo.outline,
      hasLostFocus: false,
    });

    // Detect Focus Blur Suppression
    if (/(?:^|\W)blur\s*\(/i.test(stepInfo.onfocus)) {
      if (!blurSuppressionNodes.some((n) => n.target.includes(stepInfo.selector))) {
        blurSuppressionNodes.push({
          target: [stepInfo.selector],
          html: stepInfo.html,
          failureSummary:
            'Interactive component programmatically removes focus upon receipt via inline onfocus handler (Technique F55 / SC 2.1.1, 2.4.7, 3.2.1).',
          details: { onfocus: stepInfo.onfocus, tagName: stepInfo.tag, step: i + 1 },
        });
      }
    }

    // Detect Keyboard Trap (SC 2.1.2)
    if (stepInfo.selector === lastSelector) {
      consecutiveSameCount++;
      if (
        consecutiveSameCount >= 3 &&
        !trapNodes.some((n) => n.target.includes(stepInfo.selector))
      ) {
        trapNodes.push({
          target: [stepInfo.selector],
          html: stepInfo.html,
          failureSummary:
            'Focus is trapped on this component; repeated Tab presses cannot advance focus away (SC 2.1.2 No Keyboard Trap).',
          details: { selector: stepInfo.selector, consecutivePresses: consecutiveSameCount },
        });
      }
    } else {
      consecutiveSameCount = 0;
      lastSelector = stepInfo.selector;
    }

    // Detect Missing Focus Indicator under keyboard navigation
    if (stepInfo.noOutline && stepInfo.noShadow) {
      if (!missingFocusNodes.some((n) => n.target.includes(stepInfo.selector))) {
        missingFocusNodes.push({
          target: [stepInfo.selector],
          html: stepInfo.html,
          failureSummary:
            'Focused element displays no visible keyboard focus indicator under active keyboard focus (outline is none/0 with no compensating box-shadow) (Technique F78 / SC 2.4.7).',
          details: { outline: stepInfo.outline, boxShadow: stepInfo.boxShadow, step: i + 1 },
        });
      }
    }
  }

  if (trapNodes.length > 0) {
    violations.push({
      id: 'keyboard-trap',
      impact: 'critical',
      description:
        'Keyboard focus is trapped within a component and cannot be moved away using standard keyboard navigation.',
      help: 'Keyboard focus must not be trapped in any component',
      helpUrl: 'https://www.w3.org/TR/WCAG20/#keyboard-operation-trapping',
      tags: ['wcag2a', 'wcag212'],
      requirements: ['2.1.2'],
      nodes: trapNodes,
    });
  }

  if (blurSuppressionNodes.length > 0) {
    violations.push({
      id: 'keyboard-focus-blur-suppression',
      impact: 'critical',
      description:
        'Script removes focus from an interactive component when it receives focus, breaking keyboard navigation, assistive technology focus tracking, and visual focus position.',
      help: 'Interactive elements must not remove focus upon receiving it',
      helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F55.html',
      tags: ['wcag2a', 'wcag2aa', 'wcag211', 'wcag247', 'wcag321'],
      requirements: ['2.1.1', '2.4.7', '3.2.1'],
      nodes: blurSuppressionNodes,
    });
  }

  if (missingFocusNodes.length > 0) {
    violations.push({
      id: 'keyboard-focus-indicator-missing',
      impact: 'serious',
      description:
        'Element outline or focus indicator is set to none or 0 without an alternative visual focus indicator under keyboard navigation.',
      help: 'Interactive elements must display a visible focus indicator',
      helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F78.html',
      tags: ['wcag2aa', 'wcag247'],
      requirements: ['2.4.7'],
      nodes: missingFocusNodes,
    });
  }

  return { violations, tabSequence };
}

/**
 * Inspects DOM for preliminary applicability suggestions.
 * Note: Keeps all review tasks unresolved and does NOT create automated reviewer decisions.
 */
export async function detectCriterionApplicability(
  page: BrowserPage,
): Promise<Record<string, { applicable: boolean; reason: string }>> {
  try {
    await page.evaluate('window.__name = function(fn) { return fn; };');
  } catch {}
  return page.evaluate(() => {
    const result: Record<string, { applicable: boolean; reason: string }> = {};

    // Media Elements Check (SC 1.2.1 - 1.2.5)
    const mediaCount = document.querySelectorAll('audio, video, track, object, embed').length;
    if (mediaCount === 0) {
      const mediaReason =
        'Preliminary applicability suggestion: Initial DOM inspection found 0 media elements (<audio>, <video>, <track>, <object>, <embed>). Candidate for Not Applicable. Reviewer must verify across dynamic states and user journeys before confirming.';
      for (const id of ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5']) {
        result[id] = { applicable: false, reason: mediaReason };
      }
    }

    // Form Controls Check (SC 3.3.1 - 3.3.4)
    const formControlCount = document.querySelectorAll('form, input, select, textarea').length;
    if (formControlCount === 0) {
      const formReason =
        'Preliminary applicability suggestion: Initial DOM inspection found 0 standard form controls (<form>, <input>, <select>, <textarea>). Candidate for Not Applicable. Reviewer must verify whether custom interactive input widgets exist before confirming.';
      for (const id of ['3.3.1', '3.3.2', '3.3.3', '3.3.4']) {
        result[id] = { applicable: false, reason: formReason };
      }
    }

    // Tables Check (SC 1.3.1)
    const tableCount = document.querySelectorAll('table').length;
    if (tableCount === 0) {
      result['1.3.1-tables'] = {
        applicable: false,
        reason:
          'Preliminary applicability suggestion: 0 <table> elements detected in initial DOM. Other 1.3.1 structures (lists, headings, form labels) remain applicable.',
      };
    }

    return result;
  });
}

/**
 * Runs the full suite of interactive probes, keyboard navigation analysis,
 * table structure analysis, and candidate heuristic evaluations.
 */
export async function runInteractiveProbeSuite(page: BrowserPage): Promise<ProbeResult> {
  // 1. Run sequential keyboard navigation probe
  const { violations: keyboardViolations, tabSequence } = await probeKeyboardNavigation(page);

  // 2. Run DOM-evaluated structural, pointer, and title probes
  try {
    await page.evaluate('window.__name = function(fn) { return fn; };');
  } catch {}
  const domViolations = await page.evaluate(() => {
    const getCssSelector = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 4) {
        let sel = cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className === 'string') {
          const firstClass = cur.className.trim().split(/\s+/)[0];
          if (firstClass && !firstClass.includes(':')) sel += `.${firstClass}`;
        }
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            sel += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(sel);
        cur = parent;
      }
      return parts.join(' > ');
    };

    const violations: ProbeViolation[] = [];

    // Probe A: Static Focus Blur Suppression (Technique F55 / SC 2.1.1, 2.4.7, 3.2.1)
    const blurNodes: ProbeNode[] = [];
    const interactiveSelectors =
      'a, button, input, select, textarea, [tabindex], [role="button"], [role="link"], [role="menuitem"]';
    document.querySelectorAll(interactiveSelectors).forEach((el) => {
      const onfocus = el.getAttribute('onfocus') || el.getAttribute('onfocusin') || '';
      if (/(?:^|\W)blur\s*\(/i.test(onfocus)) {
        blurNodes.push({
          target: [getCssSelector(el)],
          html: el.outerHTML.slice(0, 400),
          failureSummary:
            'Interactive element programmatically suppresses keyboard focus on receipt via inline onfocus handler (Technique F55 / SC 2.1.1, 2.4.7, 3.2.1).',
          details: { onfocus, tagName: el.tagName.toLowerCase() },
        });
      }
    });

    if (blurNodes.length > 0) {
      violations.push({
        id: 'keyboard-focus-blur-suppression',
        impact: 'critical',
        description:
          'Script removes focus from an interactive component when it receives focus, breaking keyboard navigation, assistive technology focus tracking, and visual focus position.',
        help: 'Interactive elements must not remove focus upon receiving it',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F55.html',
        tags: ['wcag2a', 'wcag2aa', 'wcag211', 'wcag247', 'wcag321'],
        requirements: ['2.1.1', '2.4.7', '3.2.1'],
        nodes: blurNodes,
      });
    }

    // Probe B: Pointer Event Handlers Missing Keyboard Parity (Candidate for validation) (Technique F54 / SC 2.1.1)
    const pointerNodes: ProbeNode[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const mouse = el.getAttribute('onmouseover') || el.getAttribute('onmouseenter');
      const focus = el.getAttribute('onfocus') || el.getAttribute('onfocusin');
      const key =
        el.getAttribute('onkeydown') || el.getAttribute('onkeyup') || el.getAttribute('onkeypress');
      const tabIndex = el.getAttribute('tabindex');
      const isNaturallyFocusable = ['a', 'button', 'input', 'select', 'textarea'].includes(
        el.tagName.toLowerCase(),
      );
      const isFocusable =
        isNaturallyFocusable || (tabIndex !== null && parseInt(tabIndex, 10) >= 0);

      if (mouse && !focus && !key && !isFocusable) {
        pointerNodes.push({
          target: [getCssSelector(el)],
          html: el.outerHTML.slice(0, 400),
          failureSummary:
            'Interactive pointing-device handler (onmouseover/onmouseenter) provided without inline keyboard handler or focusability (Technique F54 / SC 2.1.1). Candidate barrier: verify whether keyboard behavior or equivalent is provided via script or accessible alternative.',
          details: { mouseHandler: mouse.slice(0, 150), tagName: el.tagName.toLowerCase() },
        });
      }
    });

    if (pointerNodes.length > 0) {
      violations.push({
        id: 'pointer-event-missing-keyboard',
        impact: 'serious',
        candidate: true,
        description:
          'Interactive function is triggered by pointing device events without keyboard equivalents, potentially locking out keyboard users.',
        help: 'Interactive functions must be operable through a keyboard interface',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F54.html',
        tags: ['wcag2a', 'wcag211'],
        requirements: ['2.1.1'],
        nodes: pointerNodes,
      });
    }

    // Probe C: Fallback Focus Indicator Check for Elements with Explicit outline:none
    const focusableQuery =
      'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const focusableElements = Array.from(document.querySelectorAll(focusableQuery));
    const missingFocusNodes: ProbeNode[] = [];

    for (const el of focusableElements.slice(0, 30)) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) continue;
      const initialStyle = window.getComputedStyle(htmlEl);
      if (initialStyle.display === 'none' || initialStyle.visibility === 'hidden') continue;

      const defOutline = initialStyle.outlineStyle;
      const defOutlineW = parseFloat(initialStyle.outlineWidth) || 0;
      const defShadow = initialStyle.boxShadow;
      const defBg = initialStyle.backgroundColor;
      const defColor = initialStyle.color;
      const defBorder = `${initialStyle.borderWidth} ${initialStyle.borderColor}`;

      try {
        htmlEl.focus({ preventScroll: true });
      } catch {
        continue;
      }

      const focStyle = window.getComputedStyle(htmlEl);
      const focOutline = focStyle.outlineStyle;
      const focOutlineW = parseFloat(focStyle.outlineWidth) || 0;
      const focShadow = focStyle.boxShadow;
      const focBg = focStyle.backgroundColor;
      const focColor = focStyle.color;
      const focBorder = `${focStyle.borderWidth} ${focStyle.borderColor}`;

      const noOutline = focOutline === 'none' || focOutlineW === 0;
      const noShadow =
        !focShadow ||
        focShadow === 'none' ||
        focShadow === defShadow ||
        focShadow.includes('rgba(0, 0, 0, 0)');
      const unchangedVisuals = focBg === defBg && focColor === defColor && focBorder === defBorder;

      if (noOutline && noShadow && unchangedVisuals) {
        missingFocusNodes.push({
          target: [getCssSelector(htmlEl)],
          html: htmlEl.outerHTML.slice(0, 400),
          failureSummary:
            'Interactive element has no visible keyboard focus indicator when focused. Outline is suppressed with no compensating border, background, or box-shadow change (Technique F78 / SC 2.4.7).',
          details: {
            unfocused: { outline: `${defOutlineW}px ${defOutline}`, border: defBorder },
            focused: { outline: `${focOutlineW}px ${focOutline}`, border: focBorder },
          },
        });
      }

      try {
        htmlEl.blur();
      } catch {
        // no-op
      }
    }

    if (missingFocusNodes.length > 0) {
      violations.push({
        id: 'keyboard-focus-indicator-missing',
        impact: 'serious',
        description:
          'Element outline or focus indicator is set to none or 0 without an alternative visual focus indicator, preventing keyboard users from identifying the active element.',
        help: 'Interactive elements must display a visible focus indicator',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F78.html',
        tags: ['wcag2aa', 'wcag247'],
        requirements: ['2.4.7'],
        nodes: missingFocusNodes,
      });
    }

    // Probe D: Layout vs Data Table Analyzer (Technique F46 & F49 / SC 1.3.1 & 1.3.2)
    const layoutThMisuseNodes: ProbeNode[] = [];
    document.querySelectorAll('table').forEach((table) => {
      const role = table.getAttribute('role');
      const isPresentation = role === 'presentation' || role === 'none';
      const thList = Array.from(table.querySelectorAll('th'));
      const tdList = Array.from(table.querySelectorAll('td'));
      const hasCaption = !!table.querySelector('caption');

      // Table is presentation or layout table with <th> elements
      if ((isPresentation && thList.length > 0) || (thList.length > 0 && tdList.length === 0)) {
        layoutThMisuseNodes.push({
          target: [getCssSelector(table)],
          html: table.outerHTML.slice(0, 400),
          failureSummary:
            'Layout table misuses <th> elements or <caption> markup for visual positioning instead of header association for tabular data (Technique F46 / SC 1.3.1).',
          details: { thCount: thList.length, tdCount: tdList.length, isPresentation, hasCaption },
        });
      }
    });

    if (layoutThMisuseNodes.length > 0) {
      violations.push({
        id: 'layout-table-th-misuse',
        impact: 'moderate',
        description:
          'Table used for layout or visual positioning inappropriately uses <th> elements or <caption> tags, confusing screen reader navigation.',
        help: 'Layout tables must not use <th> or <caption> markup',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F46.html',
        tags: ['wcag2a', 'wcag131'],
        requirements: ['1.3.1'],
        nodes: layoutThMisuseNodes,
      });
    }

    // Probe E: Visual Heading Presentation Candidate (Technique F2 / SC 1.3.1)
    const headingCandidateNodes: ProbeNode[] = [];
    document.querySelectorAll('p, div, span, td').forEach((el) => {
      const cls = el.getAttribute('class') || '';
      if (/(?:^|\s)(?:headline|newsheadline|subhead|section-title)(?:\s|$)/i.test(cls)) {
        if (!el.querySelector('h1, h2, h3, h4, h5, h6')) {
          headingCandidateNodes.push({
            target: [getCssSelector(el)],
            html: el.outerHTML.slice(0, 400),
            failureSummary:
              'Candidate visual heading: element uses heading presentation classes without semantic <h1>-<h6> markup. Reviewer validation required to confirm if this text functions as a section heading (Technique F2 / SC 1.3.1).',
            details: { className: cls, text: el.textContent?.trim().slice(0, 100) },
          });
        }
      }
    });

    if (headingCandidateNodes.length > 0) {
      violations.push({
        id: 'semantic-heading-simulated',
        impact: 'moderate',
        candidate: true,
        description:
          'Text is styled with heading presentation classes without semantic heading markup. Reviewer validation required to verify if structure conveys a section heading.',
        help: 'Headings must use semantic heading markup (h1-h6)',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F2.html',
        tags: ['wcag2a', 'wcag131'],
        requirements: ['1.3.1'],
        nodes: headingCandidateNodes,
      });
    }

    // Probe F: Document Title Missing or Generic (Technique F25 / SC 2.4.2)
    const title = document.title ? document.title.trim() : '';
    const genericTitles = [
      '',
      'untitled',
      'untitled document',
      'new page',
      'home page',
      'default',
      'index',
    ];
    if (genericTitles.includes(title.toLowerCase())) {
      violations.push({
        id: 'document-title-missing',
        impact: 'moderate',
        description:
          'The document title is missing, empty, or generic, failing to identify the contents or topic of the Web page.',
        help: 'Web pages must have titles that describe their topic or purpose',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F25.html',
        tags: ['wcag2a', 'wcag242'],
        requirements: ['2.4.2'],
        nodes: [
          {
            target: ['head > title'],
            html: `<title>${title}</title>`,
            failureSummary: `Document title "${title || '(empty)'}" does not sufficiently describe page content or purpose (Technique F25 / SC 2.4.2).`,
            details: { title },
          },
        ],
      });
    }

    return violations;
  });

  // Combine keyboardViolations and domViolations
  const violationMap = new Map<string, ProbeViolation>();
  for (const v of [...keyboardViolations, ...domViolations]) {
    const existing = violationMap.get(v.id);
    if (!existing) {
      violationMap.set(v.id, { ...v, nodes: [...v.nodes] });
    } else {
      for (const node of v.nodes) {
        if (!existing.nodes.some((n) => n.target[0] === node.target[0])) {
          existing.nodes.push(node);
        }
      }
    }
  }

  // Detect preliminary criterion applicability suggestions
  const applicability = await detectCriterionApplicability(page);

  return {
    violations: Array.from(violationMap.values()),
    tabSequence,
    applicability,
  };
}

/**
 * Executes deterministic and candidate interactive accessibility probes via Playwright.
 * Evaluates real-time keyboard navigation, focus indicators, table structure, and heading candidates.
 */
export async function runInteractiveProbes(page: BrowserPage): Promise<ProbeViolation[]> {
  const result = await runInteractiveProbeSuite(page);
  return result.violations;
}
