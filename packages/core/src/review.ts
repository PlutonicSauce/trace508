import { db } from './db';
import { z } from 'zod';
import { evidenceHash, stableId } from './ids';
import { AppError } from './errors';

export const decisionSchema = z.object({
  reviewer: z.string().trim().min(2).max(500),
  reviewerQualification: z.string().trim().max(500).optional(),
  methodology: z.string().trim().max(500).optional(),
  outcome: z.enum([
    'Supports',
    'Partially Supports',
    'Does Not Support',
    'Not Applicable',
    'confirmed',
    'rejected',
    'reopen',
  ]),
  notes: z.string().trim().min(30).max(6000),
  evidenceIds: z.array(z.string()).max(100).default([]),
  observation: z.string().trim().min(30).max(6000).optional(),
  isTestActivity: z.boolean().optional(),
});

export async function saveDecision(
  id: string,
  value: unknown,
  auth?: { user: { role: string; organizationId: string }; projectId?: string },
) {
  if (auth && !['reviewer', 'admin'].includes(auth.user.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Your role does not permit recording reviewer decisions.');
  }

  const data = decisionSchema.parse(value);

  return db.$transaction(async (tx) => {
    // Serialize reviewer edits to keep the latest decision and task status consistent.
    await tx.$queryRaw`SELECT id FROM "ReviewTask" WHERE id=${id} FOR UPDATE`;
    const task = await tx.reviewTask.findUniqueOrThrow({
      where: { id },
      include: {
        assessment: {
          include: {
            project: true,
          },
        },
        requirement: true,
      },
    });

    // Check project and organization scope boundaries
    if (auth?.projectId && task.assessment.projectId !== auth.projectId) {
      throw new AppError(404, 'NOT_FOUND', 'Review task not found in this project.');
    }
    if (
      auth?.user?.organizationId &&
      task.assessment.project.organizationId !== auth.user.organizationId
    ) {
      throw new AppError(404, 'NOT_FOUND', 'Review task not found in this organization.');
    }

    if (task.assessment.status !== 'completed') {
      throw new AppError(
        400,
        'ASSESSMENT_INCOMPLETE',
        'Complete the scan before recording a reviewer decision.',
      );
    }

    const valid =
      task.kind === 'criterion'
        ? ['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'reopen']
        : ['confirmed', 'rejected', 'reopen'];
    if (!valid.includes(data.outcome)) {
      throw new AppError(
        400,
        'INVALID_OUTCOME',
        `Outcome "${data.outcome}" does not match review task kind "${task.kind}".`,
      );
    }

    // Comprehensive Evidence-to-Requirement Integrity Validation
    if (data.evidenceIds.length > 0) {
      const evidence = await tx.evidence.findMany({
        where: { id: { in: data.evidenceIds } },
        include: {
          page: {
            include: {
              assessment: true,
            },
          },
          finding: {
            include: {
              mappings: true,
            },
          },
        },
      });

      if (evidence.length !== new Set(data.evidenceIds).size) {
        throw new AppError(
          400,
          'EVIDENCE_NOT_FOUND',
          'One or more specified evidence items could not be found.',
        );
      }

      for (const e of evidence) {
        // Enforce page boundary
        if (e.pageId !== task.pageId) {
          throw new AppError(
            400,
            'FOREIGN_EVIDENCE',
            `Evidence ${e.id} belongs to page "${e.pageId}", not review task page "${task.pageId}".`,
          );
        }

        // Enforce assessment boundary
        if (e.page.assessmentId !== task.assessmentId) {
          throw new AppError(
            400,
            'FOREIGN_EVIDENCE',
            `Evidence ${e.id} belongs to assessment "${e.page.assessmentId}", not task assessment "${task.assessmentId}".`,
          );
        }

        // Enforce project/organization boundary
        if (e.page.assessment.projectId !== task.assessment.projectId) {
          throw new AppError(
            400,
            'FOREIGN_EVIDENCE',
            `Evidence ${e.id} belongs to another project or organization. Cross-organization evidence is strictly forbidden.`,
          );
        }

        // Enforce finding association for finding-validation tasks
        if (task.kind === 'finding') {
          if (e.findingId && e.findingId !== task.findingId) {
            throw new AppError(
              400,
              'EVIDENCE_FINDING_MISMATCH',
              `Evidence ${e.id} belongs to finding "${e.findingId}", which does not match task finding "${task.findingId}".`,
            );
          }
        }

        // Enforce criterion association for criterion-conformance tasks
        if (task.kind === 'criterion') {
          if (e.finding) {
            const mapsToCriterion = e.finding.mappings.some(
              (m) => m.requirementId === task.requirementId,
            );
            if (!mapsToCriterion) {
              const mappedCriteria =
                e.finding.mappings.map((m) => `WCAG ${m.requirementId}`).join(', ') || 'none';
              throw new AppError(
                400,
                'EVIDENCE_CRITERION_MISMATCH',
                `Evidence ${e.id} from automated rule "${e.finding.ruleId}" maps to [${mappedCriteria}], which does not support reviewed criterion WCAG ${task.requirementId} (${task.requirement.title}). An automated finding cannot justify an unrelated accessibility criterion.`,
              );
            }
          } else if (e.kind === 'human-observation') {
            const payload = (e.payload as Record<string, unknown>) || {};
            if (payload.requirementId && payload.requirementId !== task.requirementId) {
              throw new AppError(
                400,
                'OBSERVATION_CRITERION_MISMATCH',
                `Prior human observation ${e.id} was created for WCAG ${payload.requirementId}, not reviewed criterion WCAG ${task.requirementId}.`,
              );
            }
          } else if (!['scan', 'dom-snapshot'].includes(e.kind)) {
            throw new AppError(
              400,
              'UNSUPPORTED_EVIDENCE_KIND',
              `Evidence kind "${e.kind}" cannot be attached as justification for a criterion decision.`,
            );
          }
        }
      }
    }

    // Require documented human observation for criterion decisions
    if (task.kind === 'criterion' && data.outcome !== 'reopen') {
      if (!data.observation || data.observation.trim().length < 30) {
        throw new AppError(
          400,
          'OBSERVATION_REQUIRED',
          `Criterion conformance decisions for WCAG ${task.requirementId} (${task.requirement.title}) require a documented human observation with test steps, assistive technology or tools used, and observed results (minimum 30 characters). Automated scans alone cannot establish conformance.`,
        );
      }
    }

    const ids = [...new Set(data.evidenceIds)];
    if (data.observation) {
      const eid = stableId(id, data.reviewer, new Date().toISOString(), data.observation);
      await tx.evidence.create({
        data: {
          id: eid,
          pageId: task.pageId,
          kind: 'human-observation',
          summary: data.observation,
          payload: {
            reviewer: data.reviewer,
            reviewerQualification:
              data.reviewerQualification ?? 'Self-Attested Auditor (Unverified)',
            methodology: data.methodology ?? 'Revised Section 508 / ICT Testing Baseline',
            taskId: id,
            requirementId: task.requirementId,
            criterionTitle: task.requirement.title,
            outcome: data.outcome,
            observation: data.observation,
            isTestActivity: data.isTestActivity ?? false,
            timestamp: new Date().toISOString(),
          },
          sha256: evidenceHash({
            reviewer: data.reviewer,
            reviewerQualification:
              data.reviewerQualification ?? 'Self-Attested Auditor (Unverified)',
            methodology: data.methodology ?? 'Revised Section 508 / ICT Testing Baseline',
            taskId: id,
            requirementId: task.requirementId,
            outcome: data.outcome,
            observation: data.observation,
          }),
          hashScheme: 'canonical-json-sha256-v1',
        },
      });
      ids.push(eid);
    }

    if (data.outcome !== 'reopen' && !ids.length) {
      throw new AppError(
        400,
        'EVIDENCE_REQUIRED',
        'A decision requires scanner evidence or a documented observation.',
      );
    }

    const decision = await tx.reviewerDecision.create({
      data: {
        taskId: id,
        reviewer: data.reviewer,
        reviewerQualification: data.reviewerQualification ?? 'Self-Attested Auditor (Unverified)',
        methodology: data.methodology ?? 'Revised Section 508 / ICT Testing Baseline',
        outcome: data.outcome,
        notes: data.notes,
        evidenceIds: ids,
        invalidatedAt: null,
        invalidationReason: null,
      },
    });

    await tx.reviewTask.update({
      where: { id },
      data: { status: data.outcome === 'reopen' ? 'open' : 'resolved' },
    });

    await tx.auditEvent.create({
      data: {
        assessmentId: task.assessmentId,
        actor: data.reviewer,
        action: 'review-decision',
        detail: `${task.kind} task ${id} (WCAG ${task.requirementId}): ${data.outcome} [Qualification: ${data.reviewerQualification ?? 'Self-Attested Auditor (Unverified)'}; Method: ${data.methodology ?? 'Revised Section 508 / ICT Testing Baseline'}]; ${data.notes}${data.isTestActivity ? ' [TEST ACTIVITY]' : ''}`,
      },
    });

    return decision;
  });
}
