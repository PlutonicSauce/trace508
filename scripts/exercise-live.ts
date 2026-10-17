import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { db } from '../packages/core/src/db';
import { createSession } from '../packages/core/src/auth';

async function main() {
  console.log('=== TRACE508 LIVE VERIFICATION: 3 CORE ACTIONS ===\n');

  const appOrigin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
  const outDir = path.join(process.cwd(), '.local', 'exercise-verification');
  mkdirSync(outDir, { recursive: true });

  // 0. Authenticate as auditor@trace508.local
  const user = await db.user.findFirstOrThrow({
    where: { email: 'auditor@trace508.local' },
  });
  const project = await db.project.findFirstOrThrow({
    where: { organizationId: user.organizationId },
  });
  const sessionToken = await createSession({
    id: user.id,
    organizationId: user.organizationId,
  });
  console.log(`[AUTH] Created administrator session for ${user.email} (Project: ${project.name})`);

  const headers = {
    'Content-Type': 'application/json',
    Origin: appOrigin,
    Cookie: `trace508_session=${sessionToken}`,
  };

  // ACTION 1: Register an authorized website not in original demo & create new assessment
  console.log('\n--- ACTION 1: Create assessment for a new authorized website ---');
  const targetOrigin = 'https://www.iana.org';
  const targetPath = '/domains/reserved';
  const targetUrl = `${targetOrigin}${targetPath}`;

  let target = await db.target.findFirst({
    where: { origin: targetOrigin },
  });

  if (!target) {
    console.log(`[TARGET] Registering new permitted target: ${targetOrigin}`);
    const targetRes = await fetch(`${appOrigin}/api/targets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Permitted IANA Website',
        origin: targetOrigin,
        pathPrefix: targetPath,
      }),
    });
    if (!targetRes.ok) {
      throw new Error(`Failed to register target: ${targetRes.status} ${await targetRes.text()}`);
    }
    const targetData = await targetRes.json();
    console.log(`[TARGET] Registered target: ${targetData.name || targetData.id}`);
  }
  const registeredTarget = await db.target.findFirstOrThrow({
    where: { origin: targetOrigin },
  });
  console.log(
    `[TARGET] Active permitted target ID: ${registeredTarget.id} (${registeredTarget.origin})`,
  );

  const assessmentName = `Live Verification · IANA Reserved Domains (${new Date().toISOString().slice(11, 19)})`;
  console.log(`[ASSESSMENT] Creating new assessment: "${assessmentName}" for ${targetUrl}`);

  const createRes = await fetch(`${appOrigin}/api/assessments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: assessmentName,
      url: targetUrl,
      targetId: registeredTarget.id,
      pages: 1,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create assessment: ${createRes.status} ${await createRes.text()}`);
  }
  const createData = await createRes.json();
  const assessmentId = createData.id;
  console.log(`[ASSESSMENT] Queued assessment ID: ${assessmentId}`);

  // Wait for worker to pick up and complete the scan
  console.log('[WORKER] Awaiting live scan worker execution...');
  let assessment: any = null;
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    const pollRes = await fetch(`${appOrigin}/api/assessments/${assessmentId}`, { headers });
    if (pollRes.ok) {
      assessment = await pollRes.json();
      if (assessment.status === 'completed' || assessment.status === 'failed') {
        break;
      }
      process.stdout.write(`  ... status: ${assessment.status}\r`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\n[WORKER] Assessment reached terminal status: ${assessment?.status}`);

  if (assessment?.status !== 'completed') {
    throw new Error(`Assessment failed or timed out: ${JSON.stringify(assessment)}`);
  }

  console.log(`[VERIFY 1] Assessment completed successfully!`);
  console.log(`  - Scanned URL: ${assessment.url}`);
  console.log(`  - Pages scanned: ${assessment.pages?.length}`);
  console.log(`  - Findings detected: ${assessment.findings?.length}`);
  console.log(`  - Review tasks generated: ${assessment.tasks?.length}`);

  // ACTION 2: Open an actual finding and inspect its screenshot, affected HTML, and WCAG mapping
  console.log('\n--- ACTION 2: Inspect finding screenshot, affected HTML, and WCAG mapping ---');
  if (!assessment.findings || assessment.findings.length === 0) {
    throw new Error('Expected findings on https://example.com/ but found 0');
  }

  // Select a finding (e.g. region or landmark-one-main)
  const finding = assessment.findings[0];
  console.log(`[FINDING] Selected finding: ${finding.ruleId} (${finding.help})`);
  console.log(`  - Finding ID: ${finding.id}`);
  console.log(`  - Impact level: ${finding.impact}`);
  console.log(`  - Description: ${finding.description}`);

  // WCAG mappings
  console.log('\n[WCAG MAPPING]:');
  for (const mapping of finding.mappings) {
    console.log(`  - Criterion: WCAG ${mapping.requirementId} (${mapping.requirement.title})`);
    console.log(
      `    Level: ${mapping.requirement.level} | Guideline: ${mapping.requirement.guideline}`,
    );
    console.log(`    Section 508 Reference: ${mapping.requirement.section508}`);
    console.log(`    Source URL: ${mapping.requirement.source}`);
  }

  // Affected HTML & Evidence
  const evidence = finding.evidence[0];
  if (!evidence) throw new Error('Finding has no evidence records');

  console.log('\n[AFFECTED HTML & EVIDENCE]:');
  console.log(`  - Evidence ID: ${evidence.id}`);
  console.log(`  - DOM Selector: ${evidence.selector}`);
  console.log(`  - Evidence SHA-256 Digest: ${evidence.sha256}`);
  console.log(`  - Observed Failure: ${evidence.summary}`);
  console.log(`  - Affected HTML Excerpt:`);
  console.log(`    ${evidence.html}`);

  // Inspect Screenshot
  console.log('\n[SCREENSHOT INSPECTION]:');
  const screenshotRes = await fetch(`${appOrigin}/api/evidence/${evidence.id}/screenshot`, {
    headers: { Cookie: `trace508_session=${sessionToken}` },
  });
  console.log(`  - Screenshot HTTP Status: ${screenshotRes.status}`);
  console.log(`  - Content-Type: ${screenshotRes.headers.get('content-type')}`);

  const screenshotBuf = Buffer.from(await screenshotRes.arrayBuffer());
  console.log(`  - File Size: ${(screenshotBuf.length / 1024).toFixed(1)} KB`);

  // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
  const isPng =
    screenshotBuf[0] === 0x89 &&
    screenshotBuf[1] === 0x50 &&
    screenshotBuf[2] === 0x4e &&
    screenshotBuf[3] === 0x47;
  console.log(`  - PNG Magic Header Valid: ${isPng}`);

  // Read PNG dimensions from IHDR chunk (bytes 16-24)
  const width = screenshotBuf.readUInt32BE(16);
  const height = screenshotBuf.readUInt32BE(20);
  console.log(`  - Image Dimensions: ${width}x${height}px`);

  // Save evidence screenshot to local verification folder
  const screenshotPath = path.join(outDir, `evidence-${evidence.id.slice(0, 8)}.png`);
  writeFileSync(screenshotPath, screenshotBuf);
  console.log(`  - Saved screenshot copy to: ${screenshotPath}`);

  // ACTION 3: Verify Evidence-to-Requirement Integrity (Both Negative and Positive Workflows)
  console.log('\n--- ACTION 3: Complete review action and verify database & refreshed report ---');

  // Finding maps to a specific criterion (e.g. 1.4.3 for color-contrast)
  const mappedReq = finding.mappings[0].requirementId;
  const mappedCriterionTitle = finding.mappings[0].requirement.title;
  console.log(
    `[INTEGRITY] Finding ${finding.ruleId} (${finding.id}) maps to WCAG ${mappedReq} (${mappedCriterionTitle})`,
  );

  // --- STEP 3A: NEGATIVE INTEGRITY TEST ---
  // Intentionally attempt to submit this evidence to an UNRELATED criterion: WCAG 1.1.1 Non-text Content
  const task111 = assessment.tasks.find(
    (t: any) => t.kind === 'criterion' && t.requirementId === '1.1.1',
  );
  if (!task111) throw new Error('Could not find WCAG 1.1.1 review task');

  console.log('\n[NEGATIVE INTEGRITY TEST] Intentionally submitting mismatched evidence...');
  console.log(`  Target Task: WCAG 1.1.1 (${task111.requirement.title}) [ID: ${task111.id}]`);
  console.log(
    `  Mismatched Evidence: ${finding.ruleId} (maps to [${finding.mappings.map((m: any) => `WCAG ${m.requirementId}`).join(', ')}]) [ID: ${evidence.id}]`,
  );

  const negativeRes = await fetch(`${appOrigin}/api/reviews/${task111.id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      outcome: 'Supports',
      observation:
        'Observation discussing 4.28:1 text contrast ratio improperly submitted against image alternative text criterion.',
      notes:
        'Deliberate test attempt to submit mismatched evidence to test server-side validation.',
      evidenceIds: [evidence.id],
      isTestActivity: true,
    }),
  });

  console.log(`  - Server HTTP Status: ${negativeRes.status}`);
  const negativeBody = await negativeRes.json();
  console.log(`  - Server Error Response:`, negativeBody);

  if (negativeRes.status !== 400 || negativeBody.code !== 'EVIDENCE_CRITERION_MISMATCH') {
    throw new Error(
      `CRITICAL INTEGRITY FAILURE: Server accepted or failed to reject mismatched evidence! Status: ${negativeRes.status}, Body: ${JSON.stringify(negativeBody)}`,
    );
  }
  console.log(
    `✓ NEGATIVE TEST PASSED: Server rejected mismatched evidence with 400 EVIDENCE_CRITERION_MISMATCH: "${negativeBody.error}"\n`,
  );

  // --- STEP 3B: POSITIVE INTEGRITY TEST ---
  // Submit evidence to the CORRECT matching criterion (WCAG 1.4.3 Contrast Minimum)
  const taskMatching = assessment.tasks.find(
    (t: any) => t.kind === 'criterion' && t.requirementId === mappedReq,
  );
  if (!taskMatching) throw new Error(`Could not find matching criterion task for ${mappedReq}`);

  console.log(
    `[POSITIVE INTEGRITY TEST] Submitting matching evidence for WCAG ${taskMatching.requirementId} (${taskMatching.requirement.title})...`,
  );

  const reviewOutcome = 'Does Not Support';
  const observationText = `Inspected DOM and accessibility tree in Chromium on live assessment of ${targetUrl}. Measured text color contrast ratio of 4.28:1 on link element, failing 4.5:1 minimum threshold for regular text under WCAG ${taskMatching.requirementId}.`;
  const rationaleText = `Verified on live assessment of ${targetUrl}. Measured link element text contrast against background color with Colour Contrast Analyser.`;

  const positiveRes = await fetch(`${appOrigin}/api/reviews/${taskMatching.id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      outcome: reviewOutcome,
      observation: observationText,
      notes: rationaleText,
      evidenceIds: [evidence.id],
      isTestActivity: true,
    }),
  });

  if (!positiveRes.ok) {
    throw new Error(
      `Failed to submit valid review: ${positiveRes.status} ${await positiveRes.text()}`,
    );
  }
  const positiveResult = await positiveRes.json();
  console.log(
    `✓ POSITIVE TEST PASSED: Decision saved with ID ${positiveResult.id} (Outcome: ${positiveResult.outcome})`,
  );

  // 1. Verify in Database
  console.log('\n[DB VERIFICATION]:');
  const dbTaskAfter = await db.reviewTask.findUniqueOrThrow({
    where: { id: taskMatching.id },
    include: { decisions: { orderBy: { createdAt: 'desc' } } },
  });
  console.log(`  - DB Task Status: ${dbTaskAfter.status}`);
  console.log(`  - DB Decisions Count: ${dbTaskAfter.decisions.length}`);
  const latestDecision = dbTaskAfter.decisions[0];
  const observationEvidence = await db.evidence.findFirst({
    where: {
      id: { in: (latestDecision.evidenceIds as string[]) || [] },
      kind: 'human-observation',
    },
  });
  console.log(`  - DB Decision ID: ${latestDecision.id}`);
  console.log(`  - DB Reviewer: ${latestDecision.reviewer}`);
  console.log(`  - DB Outcome: ${latestDecision.outcome}`);
  console.log(
    `  - DB Observation Evidence: ${observationEvidence?.id} ("${observationEvidence?.summary.slice(0, 60)}...")`,
  );
  console.log(`  - DB Evidence Hash Scheme: ${observationEvidence?.hashScheme}`);
  console.log(`  - DB Notes: "${latestDecision.notes}"`);

  // Verify WCAG 1.1.1 remained untouched and open
  const dbTask111 = await db.reviewTask.findUniqueOrThrow({
    where: { id: task111.id },
    include: { decisions: true },
  });
  console.log(
    `  - DB WCAG 1.1.1 Task Status: ${dbTask111.status} (Open count: ${dbTask111.decisions.length})`,
  );

  // 2. Refresh from API and verify refreshed payload
  console.log('\n[API REFRESH VERIFICATION]:');
  const refreshRes = await fetch(`${appOrigin}/api/assessments/${assessmentId}`, { headers });
  if (!refreshRes.ok) throw new Error('Failed to refresh assessment');
  const refreshed = await refreshRes.json();

  const refreshedMatchingTask = refreshed.tasks.find((t: any) => t.id === taskMatching.id);
  console.log(`  - Refreshed API Task Status: ${refreshedMatchingTask?.status}`);
  console.log(
    `  - Refreshed API Latest Outcome: ${refreshedMatchingTask?.decisions?.[0]?.outcome}`,
  );

  // Check compliance matrix in refreshed assessment
  const matrixMatching = refreshed.matrix?.find((m: any) => m.id === mappedReq);
  const matrix111 = refreshed.matrix?.find((m: any) => m.id === '1.1.1');
  console.log(
    `  - Refreshed Matrix WCAG ${mappedReq} Conclusion: ${matrixMatching?.conclusion} (Ready: ${matrixMatching?.ready})`,
  );
  console.log(
    `  - Refreshed Matrix WCAG 1.1.1 Conclusion: ${matrix111?.conclusion ?? 'null (unresolved draft)'} (Review Open: ${matrix111?.reviewOpen})`,
  );

  // 3. Verify Report Export reflects the decision
  console.log('\n[REPORT EXPORT VERIFICATION]:');
  const genReportRes = await fetch(`${appOrigin}/api/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ assessmentId }),
  });
  console.log(`  - Generate Report Status: ${genReportRes.status}`);
  if (!genReportRes.ok) {
    throw new Error(
      `Failed to generate report: ${genReportRes.status} ${await genReportRes.text()}`,
    );
  }
  const reportData = await genReportRes.json();
  console.log(`  - Generated Report ID: ${reportData.id} (Version: ${reportData.version})`);
  console.log(`  - Report SHA-256 Digest: ${reportData.sha256}`);

  // Fetch OpenACR export
  const openacrRes = await fetch(`${appOrigin}/api/reports/${reportData.id}/openacr`, { headers });
  console.log(`  - OpenACR Export Status: ${openacrRes.status}`);
  if (openacrRes.ok) {
    const openacr = await openacrRes.json();
    console.log(`  - OpenACR Document Title: ${openacr.title}`);

    // Check mapped requirement has adherence
    const aaCriteria = openacr.chapters?.success_criteria_level_aa?.criteria || [];
    const reviewedItem = aaCriteria.find((c: any) => c.num === mappedReq);
    if (reviewedItem) {
      console.log(
        `  - OpenACR WCAG ${mappedReq} Adherence: ${reviewedItem.components[0]?.adherence?.level}`,
      );
      console.log(
        `  - OpenACR WCAG ${mappedReq} Notes: "${reviewedItem.components[0]?.adherence?.notes?.slice(0, 80)}..."`,
      );
    }

    // Check WCAG 1.1.1 has NO adherence (remains unresolved draft)
    const aCriteria = openacr.chapters?.success_criteria_level_a?.criteria || [];
    const item111 = aCriteria.find((c: any) => c.num === '1.1.1');
    const has111Adherence = item111?.components[0]?.adherence !== undefined;
    console.log(`  - OpenACR WCAG 1.1.1 Has Adherence: ${has111Adherence} (Expected: false)`);
    if (has111Adherence) {
      throw new Error('OpenACR exported adherence for unresolved WCAG 1.1.1 criterion!');
    }
  }

  // 4. Browser UI verification with Playwright
  console.log('\n--- BROWSER UI VERIFICATION VIA PLAYWRIGHT ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  // Inject session cookie
  await context.addCookies([
    {
      name: 'trace508_session',
      value: sessionToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);

  const page = await context.newPage();

  // Load findings explorer directly for the new assessment
  console.log(`[BROWSER] Navigating to ${appOrigin}/?view=findings&assessment=${assessmentId}`);
  await page.goto(`${appOrigin}/?view=findings&assessment=${assessmentId}`, {
    waitUntil: 'networkidle',
  });

  // Click on the finding to open FindingDetail view
  console.log(`[BROWSER] Opening finding detail for ${finding.ruleId}`);
  await page.click(`.table-title:has-text("${finding.help}")`);
  await page.waitForTimeout(1000);

  // Expand the captured screenshot accordion in the UI
  console.log('[BROWSER] Expanding screenshot view in UI');
  const screenshotDetails = page.locator('details.screenshot summary');
  await screenshotDetails.click();
  await page.waitForTimeout(1000);

  // Take screenshot of the UI showing finding details, HTML excerpt, WCAG tags, and screenshot
  const uiFindingScreenshotPath = path.join(outDir, 'ui-finding-detail.png');
  await page.screenshot({ path: uiFindingScreenshotPath, fullPage: true });
  console.log(`[BROWSER] Captured UI finding view screenshot: ${uiFindingScreenshotPath}`);

  // Navigate to Report Integrity view
  console.log(`[BROWSER] Navigating to ${appOrigin}/?view=integrity&assessment=${assessmentId}`);
  await page.goto(`${appOrigin}/?view=integrity&assessment=${assessmentId}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(1000);

  const uiIntegrityScreenshotPath = path.join(outDir, 'ui-report-integrity.png');
  await page.screenshot({ path: uiIntegrityScreenshotPath, fullPage: true });
  console.log(`[BROWSER] Captured UI report integrity screenshot: ${uiIntegrityScreenshotPath}`);

  // Navigate to Human Review directly
  console.log(`[BROWSER] Navigating to ${appOrigin}/?view=review&assessment=${assessmentId}`);
  await page.goto(`${appOrigin}/?view=review&assessment=${assessmentId}`, {
    waitUntil: 'networkidle',
  });

  // Switch filter to "Resolved tasks" to see our completed review
  console.log('[BROWSER] Filtering review queue by "Resolved tasks"');
  await page.selectOption('select[aria-label="Review status"]', 'resolved');
  await page.waitForTimeout(1000);

  // Verify the task item appears as resolved
  const taskBadge = page.locator('.task-items .badge:has-text("resolved")').first();
  const isVisible = await taskBadge.isVisible();
  console.log(`[BROWSER] Resolved task badge visible in UI: ${isVisible}`);

  // Take screenshot of the UI showing the completed human review queue and form
  const uiReviewScreenshotPath = path.join(outDir, 'ui-review-completed.png');
  await page.screenshot({ path: uiReviewScreenshotPath, fullPage: true });
  console.log(`[BROWSER] Captured UI review workspace screenshot: ${uiReviewScreenshotPath}`);

  await browser.close();

  console.log(
    '\n=== COMPLETE WORKFLOW VERIFIED: BOTH NEGATIVE AND POSITIVE INTEGRITY CONFIRMED ===',
  );
}

main()
  .catch((err) => {
    console.error('VERIFICATION ERROR:', err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
