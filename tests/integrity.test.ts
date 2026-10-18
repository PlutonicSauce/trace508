import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../packages/core/src/db';
import { saveDecision } from '../packages/core/src/review';
import { matrix, type AssessmentDetail } from '../packages/core/src/assessment';
import { openacrDocument } from '../packages/core/src/openacr';
import { generateReport } from '../packages/core/src/reports';
import { AppError } from '../packages/core/src/errors';
import { randomUUID } from 'node:crypto';
import { evidenceHash, canonicalJson, stableId } from '../packages/core/src/ids';

describe('Evidence-to-Requirement Integrity and Conformance Assurance', () => {
  const orgAId = `org-a-${randomUUID()}`;
  const orgBId = `org-b-${randomUUID()}`;
  const projAId = `proj-a-${randomUUID()}`;
  const projBId = `proj-b-${randomUUID()}`;
  const assmAId = `assm-a-${randomUUID()}`;
  const assmBId = `assm-b-${randomUUID()}`;
  const pageAId = `page-a-${randomUUID()}`;
  const pageBId = `page-b-${randomUUID()}`;

  const findingContrastId = `find-contrast-${randomUUID()}`;
  const findingImageAltId = `find-imgalt-${randomUUID()}`;
  const evidenceContrastId = `ev-contrast-${randomUUID()}`;
  const evidenceImageAltId = `ev-imgalt-${randomUUID()}`;
  const evidenceForeignId = `ev-foreign-${randomUUID()}`;

  const task111Id = `task-111-${randomUUID()}`;
  const task143Id = `task-143-${randomUUID()}`;
  const taskFindingId = `task-find-${randomUUID()}`;

  const adminAuthA = {
    user: { id: `u-admin-${randomUUID()}`, role: 'admin', organizationId: orgAId },
    projectId: projAId,
  };
  const reviewerAuthA = {
    user: { id: `u-rev-${randomUUID()}`, role: 'reviewer', organizationId: orgAId },
    projectId: projAId,
  };
  const viewerAuthA = {
    user: { id: `u-view-${randomUUID()}`, role: 'viewer', organizationId: orgAId },
    projectId: projAId,
  };
  const adminAuthB = {
    user: { id: `u-admin-b-${randomUUID()}`, role: 'admin', organizationId: orgBId },
    projectId: projBId,
  };

  beforeAll(async () => {
    // 1. Create Organizations
    await db.organization.create({ data: { id: orgAId, name: 'Integrity Test Org A' } });
    await db.organization.create({ data: { id: orgBId, name: 'Integrity Test Org B' } });

    // 2. Create Projects
    await db.project.create({
      data: { id: projAId, organizationId: orgAId, name: 'Project A' },
    });
    await db.project.create({
      data: { id: projBId, organizationId: orgBId, name: 'Project B' },
    });

    // 3. Create Completed Assessments
    await db.assessment.create({
      data: {
        id: assmAId,
        projectId: projAId,
        name: 'Assessment A',
        url: 'https://example.org/a',
        variant: 'test',
        status: 'completed',
      },
    });
    await db.assessment.create({
      data: {
        id: assmBId,
        projectId: projBId,
        name: 'Assessment B',
        url: 'https://example.org/b',
        variant: 'test',
        status: 'completed',
      },
    });

    // 4. Create Pages
    await db.page.create({
      data: { id: pageAId, assessmentId: assmAId, url: 'https://example.org/a' },
    });
    await db.page.create({
      data: { id: pageBId, assessmentId: assmBId, url: 'https://example.org/b' },
    });

    // 5. Create Findings with Mappings
    // WCAG 1.4.3 (color-contrast)
    await db.finding.create({
      data: {
        id: findingContrastId,
        assessmentId: assmAId,
        pageId: pageAId,
        ruleId: 'color-contrast',
        impact: 'serious',
        description: 'Text element has insufficient color contrast ratio of 4.28:1',
        help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        tags: ['wcag2aa', 'wcag143'],
        mappings: {
          create: [{ requirementId: '1.4.3', method: 'automated', version: 'axe-4.10' }],
        },
      },
    });

    // WCAG 1.1.1 (image-alt)
    await db.finding.create({
      data: {
        id: findingImageAltId,
        assessmentId: assmAId,
        pageId: pageAId,
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Image element has no alt attribute',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        tags: ['wcag2a', 'wcag111'],
        mappings: {
          create: [{ requirementId: '1.1.1', method: 'automated', version: 'axe-4.10' }],
        },
      },
    });

    // 6. Create Evidence Items
    await db.evidence.create({
      data: {
        id: evidenceContrastId,
        pageId: pageAId,
        findingId: findingContrastId,
        kind: 'axe-node',
        summary: 'Color contrast 4.28:1 on <a class="nav-link">Home</a>',
        sha256: 'a'.repeat(64),
      },
    });

    await db.evidence.create({
      data: {
        id: evidenceImageAltId,
        pageId: pageAId,
        findingId: findingImageAltId,
        kind: 'axe-node',
        summary: 'Missing alt on <img src="hero.jpg">',
        sha256: 'b'.repeat(64),
      },
    });

    await db.evidence.create({
      data: {
        id: evidenceForeignId,
        pageId: pageBId,
        kind: 'axe-node',
        summary: 'Foreign evidence from Organization B',
        sha256: 'c'.repeat(64),
      },
    });

    // 7. Create Review Tasks
    await db.reviewTask.create({
      data: {
        id: task111Id,
        assessmentId: assmAId,
        pageId: pageAId,
        kind: 'criterion',
        requirementId: '1.1.1',
        reason: 'Review image alternative text for WCAG 1.1.1 Non-text Content',
      },
    });

    await db.reviewTask.create({
      data: {
        id: task143Id,
        assessmentId: assmAId,
        pageId: pageAId,
        kind: 'criterion',
        requirementId: '1.4.3',
        reason: 'Review text contrast for WCAG 1.4.3 Contrast (Minimum)',
      },
    });

    await db.reviewTask.create({
      data: {
        id: taskFindingId,
        assessmentId: assmAId,
        pageId: pageAId,
        kind: 'finding',
        findingId: findingContrastId,
        requirementId: '1.4.3',
        reason: 'Validate automated color-contrast finding',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test artifacts
    await db.assessment.deleteMany({ where: { id: { in: [assmAId, assmBId] } } }).catch(() => {});
    await db.project.deleteMany({ where: { id: { in: [projAId, projBId] } } }).catch(() => {});
    await db.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {});
  });

  it('1. Rejects contrast evidence as justification for a WCAG 1.1.1 Non-text Content decision', async () => {
    await expect(
      saveDecision(
        task111Id,
        {
          reviewer: 'Auditor One',
          outcome: 'Supports',
          notes: 'Attempting to justify WCAG 1.1.1 Non-text Content using color contrast evidence.',
          evidenceIds: [evidenceContrastId],
          observation: 'Manual observation discussing 4.28:1 text contrast ratio on the page.',
        },
        reviewerAuthA,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'EVIDENCE_CRITERION_MISMATCH',
        status: 400,
      }),
    );
  });

  it('2. Rejects evidence belonging to another assessment', async () => {
    await expect(
      saveDecision(
        task111Id,
        {
          reviewer: 'Auditor One',
          outcome: 'Supports',
          notes: 'Attempting to attach foreign evidence from a completely different assessment.',
          evidenceIds: [evidenceForeignId],
          observation: 'Manual observation steps executed on another assessment.',
        },
        reviewerAuthA,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'FOREIGN_EVIDENCE',
        status: 400,
      }),
    );
  });

  it('3. Rejects review actions across organization boundaries', async () => {
    await expect(
      saveDecision(
        task111Id,
        {
          reviewer: 'Auditor Two',
          outcome: 'Supports',
          notes: 'Auditor from Organization B attempting to modify task in Organization A.',
          evidenceIds: [evidenceImageAltId],
          observation: 'Cross-tenant observation attempt.',
        },
        adminAuthB,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'NOT_FOUND',
        status: 404,
      }),
    );
  });

  it('4. Rejects review decisions from unauthorized roles (e.g. viewer)', async () => {
    await expect(
      saveDecision(
        task111Id,
        {
          reviewer: 'Viewer User',
          outcome: 'Supports',
          notes: 'Viewer role attempting to approve a criterion conformance task.',
          evidenceIds: [evidenceImageAltId],
          observation: 'Testing steps without reviewer authorization.',
        },
        viewerAuthA,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'FORBIDDEN',
        status: 403,
      }),
    );
  });

  it('5. Accepts a genuine human observation supporting the appropriate criterion', async () => {
    const decision = await saveDecision(
      task111Id,
      {
        reviewer: 'Auditor One',
        outcome: 'Does Not Support',
        notes:
          'Manual inspection and screen reader verification confirmed missing alt text on hero image.',
        evidenceIds: [evidenceImageAltId],
        observation:
          'Inspected DOM with browser inspector and tested with VoiceOver; <img src="hero.jpg"> lacks alt text and conveys substantive information.',
        isTestActivity: true,
      },
      reviewerAuthA,
    );

    expect(decision).toBeDefined();
    expect(decision.outcome).toBe('Does Not Support');
    expect(decision.invalidatedAt).toBeNull();

    // Verify task is now resolved
    const task = await db.reviewTask.findUniqueOrThrow({ where: { id: task111Id } });
    expect(task.status).toBe('resolved');

    // Verify newly generated human-observation evidence item
    const observations = await db.evidence.findMany({
      where: { pageId: pageAId, kind: 'human-observation' },
    });
    expect(observations.length).toBeGreaterThanOrEqual(1);
    const obs = observations[0];
    expect(obs.hashScheme).toBe('canonical-json-sha256-v1');
    const payload = obs.payload as any;
    expect(payload.requirementId).toBe('1.1.1');
    expect(payload.isTestActivity).toBe(true);
  });

  it('6. Ensures invalidated conclusions do not silently appear in new reports or OpenACR', async () => {
    // Invalidate the decision created in test 5 to simulate discovery of a compliance integrity issue
    const existing = await db.reviewerDecision.findFirstOrThrow({
      where: { taskId: task111Id },
      orderBy: { createdAt: 'desc' },
    });

    await db.reviewerDecision.update({
      where: { id: existing.id },
      data: {
        invalidatedAt: new Date(),
        invalidationReason: 'Test invalidation: simulated audit finding',
      },
    });

    // Reopen the review task as the migration/workflow does
    await db.reviewTask.update({
      where: { id: task111Id },
      data: { status: 'open' },
    });

    // Fetch assessment detail
    const reqs = await db.requirement.findMany({ orderBy: { id: 'asc' } });
    const assessment = await db.assessment.findUniqueOrThrow({
      where: { id: assmAId },
      include: {
        findings: { include: { evidence: true, mappings: true } },
        tasks: {
          include: {
            requirement: true,
            page: true,
            decisions: { orderBy: { createdAt: 'desc' } },
          },
        },
        pages: { include: { evidence: true } },
        runs: true,
      },
    });

    const rows = matrix(assessment as unknown as AssessmentDetail, reqs);
    const row111 = rows.find((r) => r.id === '1.1.1');
    expect(row111).toBeDefined();
    expect(row111!.conclusion).toBeNull();
    expect(row111!.ready).toBe(false);
    expect(row111!.integrityError).toContain('Prior decision was invalidated');
    expect(row111!.invalidatedDecisions).toHaveLength(1);

    // Verify OpenACR document omits adherence for this criterion
    const snapshot = {
      assessment: {
        name: 'Integrity Test Assessment',
        url: 'https://example.org/a',
        scanRuns: [],
      },
      matrix: rows,
      generatedAt: new Date().toISOString(),
      chapterApplicability: 'Unresolved',
    };

    const openacr = openacrDocument(
      snapshot,
      { name: 'Integrity Auditor', email: 'auditor@example.test' },
      1,
    );
    expect(openacr.validation.valid).toBe(true);

    const levelA = (openacr.document.chapters as any).success_criteria_level_a;
    const criterion111 = levelA.criteria.find((c: any) => c.num === '1.1.1');
    expect(criterion111).toBeDefined();
    expect(criterion111.components[0].adherence).toBeUndefined();
    expect(openacr.document.notes).toContain('INTEGRITY WARNING');
  });

  it('7. Preserves report version history and marks superseded drafts', async () => {
    // Generate Report v1
    const report1 = await generateReport(assmAId, {
      name: 'Integrity Auditor',
      email: 'auditor@example.test',
      actor: 'test-auditor',
    });
    expect(report1.version).toBe(1);
    expect(report1.status).toBe('draft');

    // Generate Report v2 in the same series
    const report2 = await generateReport(assmAId, {
      name: 'Integrity Auditor',
      email: 'auditor@example.test',
      actor: 'test-auditor',
    });
    expect(report2.version).toBe(2);
    expect(report2.status).toBe('draft');

    // Verify Report v1 was superseded and its history preserved
    const updatedReport1 = await db.report.findUniqueOrThrow({ where: { id: report1.id } });
    expect(updatedReport1.status).toBe('superseded');
    expect(updatedReport1.invalidationReason).toContain('Superseded by draft report v2');
  });

  it('8. Accepts legitimate reviewer decisions when evidence correctly matches the criterion', async () => {
    const decision = await saveDecision(
      task143Id,
      {
        reviewer: 'Auditor One',
        outcome: 'Does Not Support',
        notes: 'Confirmed color contrast failure on navigation link using devtools and eyedropper.',
        evidenceIds: [evidenceContrastId],
        observation:
          'Measured foreground #777 on background #fff: 4.28:1 contrast ratio, failing the 4.5:1 minimum threshold for regular text.',
        isTestActivity: true,
      },
      reviewerAuthA,
    );

    expect(decision).toBeDefined();
    expect(decision.outcome).toBe('Does Not Support');
    expect(decision.evidenceIds).toContain(evidenceContrastId);

    const task = await db.reviewTask.findUniqueOrThrow({ where: { id: task143Id } });
    expect(task.status).toBe('resolved');
  });

  it('9. Reloads interactive probe and tab-sequence evidence from PostgreSQL and verifies canonical SHA-256 integrity', async () => {
    const probeEvidenceId = `ev-probe-${randomUUID()}`;
    const tabEvidenceId = `ev-tab-${randomUUID()}`;

    const probeNode = {
      target: ['#test-link'],
      html: '<a href="#test" id="test-link" onfocus="blur();">Link</a>',
      failureSummary: 'Interactive component programmatically removes focus upon receipt (F55).',
      details: { onfocus: 'blur();', tagName: 'a', step: 3 },
    };
    const probePayload = JSON.parse(JSON.stringify(probeNode));
    const probeDigest = evidenceHash(probePayload);

    await db.evidence.create({
      data: {
        id: probeEvidenceId,
        pageId: pageAId,
        kind: 'interactive-probe',
        selector: JSON.stringify(probeNode.target),
        html: probeNode.html,
        summary: probeNode.failureSummary,
        payload: probePayload,
        sha256: probeDigest,
        hashScheme: 'canonical-json-sha256-v1',
      },
    });

    const tabPayload = JSON.parse(
      JSON.stringify({
        steps: [
          { step: 1, selector: '#test-link', tag: 'a', text: 'Link', outline: 'none' },
          {
            step: 2,
            selector: 'body',
            tag: 'BODY',
            text: '(Focus suppressed)',
            hasLostFocus: true,
          },
        ],
      }),
    );
    const tabDigest = evidenceHash(tabPayload);

    await db.evidence.create({
      data: {
        id: tabEvidenceId,
        pageId: pageAId,
        kind: 'tab-sequence',
        summary: 'Sequential keyboard Tab navigation trail (2 steps evaluated).',
        payload: tabPayload,
        sha256: tabDigest,
        hashScheme: 'canonical-json-sha256-v1',
      },
    });

    // Reload from PostgreSQL
    const reloadedProbe = await db.evidence.findUniqueOrThrow({ where: { id: probeEvidenceId } });
    const reloadedTab = await db.evidence.findUniqueOrThrow({ where: { id: tabEvidenceId } });

    // Verify canonical integrity
    expect(reloadedProbe.hashScheme).toBe('canonical-json-sha256-v1');
    expect(evidenceHash(reloadedProbe.payload)).toBe(reloadedProbe.sha256);
    expect(reloadedProbe.sha256).toBe(probeDigest);

    expect(reloadedTab.hashScheme).toBe('canonical-json-sha256-v1');
    expect(evidenceHash(reloadedTab.payload)).toBe(reloadedTab.sha256);
    expect(reloadedTab.sha256).toBe(tabDigest);

    // Verify detection of tampering if payload were modified
    const tamperedPayload = { ...(reloadedProbe.payload as any), details: { tampered: true } };
    expect(evidenceHash(tamperedPayload)).not.toBe(reloadedProbe.sha256);
  });

  afterAll(async () => {
    await db.reviewerDecision
      .deleteMany({ where: { task: { assessmentId: { in: [assmAId, assmBId] } } } })
      .catch(() => {});
    await db.findingRequirement
      .deleteMany({ where: { finding: { assessmentId: { in: [assmAId, assmBId] } } } })
      .catch(() => {});
    await db.evidence
      .deleteMany({ where: { page: { assessmentId: { in: [assmAId, assmBId] } } } })
      .catch(() => {});
    await db.finding
      .deleteMany({ where: { assessmentId: { in: [assmAId, assmBId] } } })
      .catch(() => {});
    await db.reviewTask
      .deleteMany({ where: { assessmentId: { in: [assmAId, assmBId] } } })
      .catch(() => {});
    await db.report
      .deleteMany({ where: { assessmentId: { in: [assmAId, assmBId] } } })
      .catch(() => {});
    await db.page
      .deleteMany({ where: { assessmentId: { in: [assmAId, assmBId] } } })
      .catch(() => {});
    await db.assessment.deleteMany({ where: { id: { in: [assmAId, assmBId] } } }).catch(() => {});
    await db.project.deleteMany({ where: { id: { in: [projAId, projBId] } } }).catch(() => {});
    await db.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {});
    await db.user
      .deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } })
      .catch(() => {});
  });
});
