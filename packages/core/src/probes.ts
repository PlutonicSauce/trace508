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
  nodes: ProbeNode[];
}

/**
 * Executes deterministic in-browser interactive accessibility probes via Playwright.
 * Evaluates real-time focus behavior, keyboard operability, pointer parity, and
 * semantic structural integrity that static DOM-only rules cannot verify.
 */
export async function runInteractiveProbes(page: BrowserPage): Promise<ProbeViolation[]> {
  return page.evaluate(() => {
    function getCssSelector(el: Element): string {
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
    }

    const violations: ProbeViolation[] = [];

    // Probe 1: Focus Blur Suppression (W3C Technique F55 / WCAG 2.1.1, 2.4.7, 3.2.1)
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

    // Probe 2: Pointer Event Handlers Missing Keyboard Parity (W3C Technique F54 / WCAG 2.1.1)
    const pointerNodes: ProbeNode[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const mouse = el.getAttribute('onmouseover') || el.getAttribute('onmouseenter');
      const focus = el.getAttribute('onfocus') || el.getAttribute('onfocusin');
      const key =
        el.getAttribute('onkeydown') || el.getAttribute('onkeyup') || el.getAttribute('onkeypress');
      if (mouse && !focus && !key) {
        pointerNodes.push({
          target: [getCssSelector(el)],
          html: el.outerHTML.slice(0, 400),
          failureSummary:
            'Interactive pointing-device-specific event handler (onmouseover/onmouseenter) provided without an equivalent keyboard event handler or keyboard focusability (Technique F54 / SC 2.1.1).',
          details: { mouseHandler: mouse.slice(0, 150), tagName: el.tagName.toLowerCase() },
        });
      }
    });

    if (pointerNodes.length > 0) {
      violations.push({
        id: 'pointer-event-missing-keyboard',
        impact: 'serious',
        description:
          'Interactive function is only triggered by pointing device events without keyboard equivalents, locking out keyboard and screen reader users.',
        help: 'Interactive functions must be operable through a keyboard interface',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F54.html',
        tags: ['wcag2a', 'wcag211'],
        requirements: ['2.1.1'],
        nodes: pointerNodes,
      });
    }

    // Probe 3: Focus Indicator Missing or Suppressed (W3C Technique F78 / WCAG 2.4.7)
    const focusableQuery =
      'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const focusableElements = Array.from(document.querySelectorAll(focusableQuery));
    const missingFocusNodes: ProbeNode[] = [];

    // Probe up to 30 visible interactive elements to measure computed focus styles
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
        focShadow === 'none' || focShadow === defShadow || focShadow.includes('rgba(0, 0, 0, 0)');
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

    // Probe 4: Visual Heading Presentation Without Semantic Markup (W3C Technique F2 / WCAG 1.3.1)
    const headingNodes: ProbeNode[] = [];
    document.querySelectorAll('p, div, span, td').forEach((el) => {
      const cls = el.getAttribute('class') || '';
      if (/(?:^|\s)(?:headline|newsheadline|subhead|section-title)(?:\s|$)/i.test(cls)) {
        if (!el.querySelector('h1, h2, h3, h4, h5, h6')) {
          headingNodes.push({
            target: [getCssSelector(el)],
            html: el.outerHTML.slice(0, 400),
            failureSummary:
              'Visual heading presentation is conveyed using a styled class or presentation element instead of semantic heading markup (<h1>-<h6>) (Technique F2 / SC 1.3.1).',
            details: { className: cls, text: el.textContent?.trim().slice(0, 100) },
          });
        }
      }
    });

    if (headingNodes.length > 0) {
      violations.push({
        id: 'semantic-heading-simulated',
        impact: 'moderate',
        description:
          'Text is styled as a heading using classes or visual styling without semantic heading markup, preventing screen reader users from navigating by structure.',
        help: 'Headings must use semantic heading markup (h1-h6)',
        helpUrl: 'https://www.w3.org/WAI/GL/WCAG20/WD-WCAG20-TECHS/F2.html',
        tags: ['wcag2a', 'wcag131'],
        requirements: ['1.3.1'],
        nodes: headingNodes,
      });
    }

    // Probe 5: Document Title Missing or Generic (W3C Technique F25 / WCAG 2.4.2)
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
}
