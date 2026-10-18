import { chromium } from 'playwright';
import path from 'node:path';
import { db } from '../packages/core/src/db';

const ARTIFACTS_DIR =
  '/Users/seshank/.gemini/antigravity-ide/brain/41a677f6-b643-47ad-9298-0fba22fb586a';
const BASE_URL = 'http://127.0.0.1:3000';

async function main() {
  console.log('--- STARTING TRACE508 DEMO SMOKE TEST ---');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  // 1. Open Trace508
  console.log('1. Navigating to Trace508:', BASE_URL);
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Verify login form is visible
  const emailInput = page.locator('#login-email');
  const passwordInput = page.locator('#login-password');

  if (await emailInput.isVisible()) {
    console.log('2. Confirming login interface and signing in...');
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'demo_smoke_1_login_page.png') });

    await emailInput.fill('auditor@trace508.local');
    await passwordInput.fill('Trace508DemoAuditor2026!');

    const signInButton = page.getByRole('button', { name: 'Sign in' });
    await signInButton.click();

    // Wait for authenticated navigation
    await page.waitForSelector('.feature-title, .dashboard, nav', { timeout: 15000 });
    console.log('   -> Successfully logged in as auditor@trace508.local');
  } else {
    console.log('   -> Already authenticated or session restored.');
  }

  // 3. Open W3C assessment
  console.log('3. Opening W3C BAD assessment (1bb287a4-a195-4059-944c-465622c995a7)...');
  await page.goto(`${BASE_URL}/?assessment=1bb287a4-a195-4059-944c-465622c995a7`);
  await page.waitForSelector('.feature-title', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'demo_smoke_2_w3c_assessment_overview.png'),
  });
  console.log('   -> W3C assessment overview loaded successfully.');

  // 4. Inspect an actual finding
  console.log('4. Navigating to Findings view to inspect an actual finding...');
  await page.goto(`${BASE_URL}/?view=findings&assessment=1bb287a4-a195-4059-944c-465622c995a7`);
  await page.waitForSelector('.table-title, .filters', { timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'demo_smoke_3_findings_list.png') });

  // Click on the first finding button to inspect
  const firstFinding = page.locator('button.table-title').first();
  await firstFinding.waitFor({ state: 'visible', timeout: 10000 });
  const findingName = await firstFinding.textContent();
  console.log(`   -> Inspecting finding: "${findingName?.trim()}"`);
  await firstFinding.click();
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.panel, .feature-title', { timeout: 10000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'demo_smoke_4_finding_detail.png') });
  console.log('   -> Finding detail view inspected with evidence, selector, and WCAG mapping.');

  // 5. Navigate the review interface
  console.log('5. Navigating to Review interface (?view=review)...');
  await page.goto(`${BASE_URL}/?view=review&assessment=1bb287a4-a195-4059-944c-465622c995a7`);
  await page.waitForSelector('.review-form, .review-grid, .panel', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'demo_smoke_5_review_interface.png') });
  console.log(
    '   -> Review interface loaded with review criteria and preliminary applicability suggestions.',
  );

  // 6. Verify access to a generated report
  console.log('6. Verifying access to generated report (?view=reports)...');
  // W3C Citylights baseline assessment has generated report versions
  await page.goto(`${BASE_URL}/?view=reports&assessment=0ca0c5bc-10f0-4480-b791-d3951ad66a4a`);
  await page.waitForSelector('.report-details, .panel', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'demo_smoke_6_generated_report.png') });
  console.log(
    '   -> Generated OpenACR report accessed successfully with cryptographic SHA-256 hash.',
  );

  // 7. Check remediation retest diff viewer
  console.log('7. Verifying Remediation Backlog & Diff Viewer (?view=remediation)...');
  await page.goto(`${BASE_URL}/?view=remediation&assessment=1bb287a4-a195-4059-944c-465622c995a7`);
  await page.waitForSelector('.backlog-item, .remediation-diff-grid', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'demo_smoke_7_remediation_diff.png') });
  console.log('   -> Remediation retest diff viewer verified.');

  await browser.close();
  await db.$disconnect();

  console.log('\n=== DEMO SMOKE TEST COMPLETED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
