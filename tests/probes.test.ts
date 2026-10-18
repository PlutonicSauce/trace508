import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { runInteractiveProbes } from '../packages/core/src/probes';
import { mapRuleToRequirements, mapTags } from '../packages/core/src/requirements';
import { benchmarkTechniqueRules } from '../packages/core/src/benchmark';

describe('Interactive Accessibility Probes Suite', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('Focus Blur Suppression Probe (F55 / SC 2.1.1, 2.4.7, 3.2.1)', () => {
    it('detects inline onfocus blur() handlers on interactive links and buttons', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head><title>Accessible Demo Page</title></head>
          <body>
            <a href="news.html" id="bad-link" onfocus="blur();">Breaking News</a>
            <button id="bad-btn" onfocus="this.blur();">Click Here</button>
            <a href="clean.html" id="clean-link">Clean Link</a>
          </body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const blurViolation = violations.find((v) => v.id === 'keyboard-focus-blur-suppression');

      expect(blurViolation).toBeDefined();
      expect(blurViolation!.impact).toBe('critical');
      expect(blurViolation!.requirements).toEqual(['2.1.1', '2.4.7', '3.2.1']);
      expect(blurViolation!.nodes).toHaveLength(2);
      expect(blurViolation!.nodes[0].target).toContain('#bad-link');
      expect(blurViolation!.nodes[1].target).toContain('#bad-btn');
    });

    it('produces zero false positives on standard accessible interactive elements', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head><title>Clean Accessible Form</title></head>
          <body>
            <a href="/home" id="home-link">Home</a>
            <button type="submit" id="submit-btn">Submit</button>
            <input type="text" id="name" aria-label="Name">
          </body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const blurViolation = violations.find((v) => v.id === 'keyboard-focus-blur-suppression');
      expect(blurViolation).toBeUndefined();
    });
  });

  describe('Pointer Events Missing Keyboard Parity Probe (F54 / SC 2.1.1)', () => {
    it('detects mouse-specific handlers without keyboard equivalents', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head><title>Hover Navigation</title></head>
          <body>
            <img id="hover-img" src="nav.gif" onmouseover="this.src='nav_over.gif'" onmouseout="this.src='nav.gif'">
            <div id="accessible-hover" onmouseover="show()" onfocus="show()" tabindex="0">Menu</div>
          </body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const pointerViolation = violations.find((v) => v.id === 'pointer-event-missing-keyboard');

      expect(pointerViolation).toBeDefined();
      expect(pointerViolation!.impact).toBe('serious');
      expect(pointerViolation!.requirements).toEqual(['2.1.1']);
      expect(pointerViolation!.nodes.some((n) => n.target.includes('#hover-img'))).toBe(true);
      expect(pointerViolation!.nodes.some((n) => n.target.includes('#accessible-hover'))).toBe(
        false,
      );
    });
  });

  describe('Focus Indicator Missing Probe (F78 / SC 2.4.7)', () => {
    it('detects focusable elements with outline: none and no visible state difference', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <title>Focus Indicator Test</title>
            <style>
              a.no-focus {
                outline: none !important;
                background-color: rgb(255, 255, 255);
                color: rgb(0, 0, 0);
                border: 0px none rgb(0, 0, 0);
              }
              a.no-focus:focus {
                outline: none !important;
                background-color: rgb(255, 255, 255);
                color: rgb(0, 0, 0);
                box-shadow: none;
                border: 0px none rgb(0, 0, 0);
              }
              a.good-focus:focus {
                outline: 2px solid rgb(0, 90, 200);
              }
            </style>
          </head>
          <body>
            <a href="#test1" id="link-no-focus" class="no-focus">Invisible Focus Link</a>
            <a href="#test2" id="link-good-focus" class="good-focus">Visible Focus Link</a>
          </body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const focusViolation = violations.find((v) => v.id === 'keyboard-focus-indicator-missing');

      expect(focusViolation).toBeDefined();
      expect(focusViolation!.impact).toBe('serious');
      expect(focusViolation!.requirements).toEqual(['2.4.7']);
      expect(focusViolation!.nodes.some((n) => n.target.includes('#link-no-focus'))).toBe(true);
      expect(focusViolation!.nodes.some((n) => n.target.includes('#link-good-focus'))).toBe(false);
    });
  });

  describe('Simulated Heading Structure Probe (F2 / SC 1.3.1)', () => {
    it('detects headline styling on non-heading tags without semantic markup', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head><title>News Articles</title></head>
          <body>
            <p class="headline">Breaking News Story</p>
            <div class="newsheadline">Secondary Report</div>
            <h2>Legitimate Heading</h2>
          </body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const headingViolation = violations.find((v) => v.id === 'semantic-heading-simulated');

      expect(headingViolation).toBeDefined();
      expect(headingViolation!.impact).toBe('moderate');
      expect(headingViolation!.requirements).toEqual(['1.3.1']);
      expect(headingViolation!.nodes).toHaveLength(2);
    });
  });

  describe('Document Title Probe (F25 / SC 2.4.2)', () => {
    it('flags empty or generic page titles', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head><title>Untitled Document</title></head>
          <body><p>Content</p></body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const titleViolation = violations.find((v) => v.id === 'document-title-missing');

      expect(titleViolation).toBeDefined();
      expect(titleViolation!.requirements).toEqual(['2.4.2']);
    });

    it('passes informative, descriptive page titles', async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
          <head><title>Section 508 Assessment Report · CityLights</title></head>
          <body><p>Content</p></body>
        </html>
      `);

      const violations = await runInteractiveProbes(page);
      const titleViolation = violations.find((v) => v.id === 'document-title-missing');
      expect(titleViolation).toBeUndefined();
    });
  });

  describe('Multi-Criterion Mapping & Benchmark Technique Alignment', () => {
    it('maps form labeling rules to WCAG 1.3.1, 3.3.2, and 4.1.2 per Technique F68', () => {
      expect(mapRuleToRequirements('label', ['wcag2a', 'wcag412'])).toEqual(
        expect.arrayContaining(['1.3.1', '3.3.2', '4.1.2']),
      );
      expect(mapRuleToRequirements('select-name', ['wcag2a', 'wcag412'])).toEqual(
        expect.arrayContaining(['1.3.1', '3.3.2', '4.1.2']),
      );
    });

    it('preserves single-criterion mappings for standard rules', () => {
      expect(mapRuleToRequirements('color-contrast', ['wcag2aa', 'wcag143'])).toEqual(['1.4.3']);
      expect(mapRuleToRequirements('image-alt', ['wcag2a', 'wcag111'])).toEqual(['1.1.1']);
    });

    it('includes all high-impact W3C failure techniques in benchmark candidate rules', () => {
      expect(benchmarkTechniqueRules.F55).toContain('keyboard-focus-blur-suppression');
      expect(benchmarkTechniqueRules.F78).toContain('keyboard-focus-indicator-missing');
      expect(benchmarkTechniqueRules.F54).toContain('pointer-event-missing-keyboard');
      expect(benchmarkTechniqueRules.F2).toContain('semantic-heading-simulated');
      expect(benchmarkTechniqueRules.F25).toContain('document-title-missing');
      expect(benchmarkTechniqueRules.F68).toContain('select-name');
    });
  });
});
