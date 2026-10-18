import dataset from '../../../data/reference-issues.json' with { type: 'json' };
import type { AssessmentDetail } from './assessment';
import { db } from './db';
import { z } from 'zod';
export const benchmarkTechniqueRules: Record<string, string[]> = {
  F65: ['image-alt', 'input-image-alt', 'area-alt'],
  F89: ['link-name'],
  F68: ['label', 'select-name', 'input-button-name'],
  F24: ['color-contrast'],
  F55: ['keyboard-focus-blur-suppression', 'keyboard-focus-trap'],
  F78: ['keyboard-focus-indicator-missing'],
  F54: ['pointer-event-missing-keyboard'],
  F2: ['semantic-heading-simulated'],
  F25: ['document-title-missing', 'document-title'],
  F70: ['duplicate-id', 'duplicate-id-active'],
  F71: ['text-lookalike'],
  F30: ['image-text-alternative'],
  F46: ['layout-table-th-misuse'],
};
const rules: Record<string, string[]> = benchmarkTechniqueRules;
export async function saveBenchmarkDecision(value: unknown) {
  const data = z
    .object({
      assessmentId: z.string().uuid(),
      referenceId: z.string(),
      findingId: z.string(),
      reviewer: z.string().trim().min(2).max(500),
      outcome: z.enum(['matched', 'rejected', 'reopen']),
      notes: z.string().trim().min(50).max(6000),
      evidenceIds: z.array(z.string()).min(1).max(100),
    })
    .parse(value);
  const reference = dataset.issues.find((i) => i.id === data.referenceId);
  const finding = await db.finding.findUniqueOrThrow({
    where: { id: data.findingId },
    include: { page: true, assessment: true, evidence: true, mappings: true },
  });
  if (
    !reference ||
    finding.assessmentId !== data.assessmentId ||
    finding.assessment.status !== 'completed' ||
    finding.assessment.variant !== 'before' ||
    !finding.page.url.endsWith(`/${reference.page}.html`) ||
    !finding.mappings.some((m) => m.requirementId === reference.criterion)
  )
    throw new Error('Evidence does not match the reference page and criterion.');
  if (data.evidenceIds.some((id) => !finding.evidence.some((e) => e.id === id)))
    throw new Error('Evidence IDs must belong to the selected finding.');
  return db.$transaction(async (tx) => {
    const decision = await tx.benchmarkDecision.create({ data });
    await tx.auditEvent.create({
      data: {
        assessmentId: data.assessmentId,
        actor: data.reviewer,
        action: 'reference-adjudication',
        detail: `${reference.id}: ${data.outcome}; finding ${finding.id}; ${data.notes}`,
      },
    });
    return decision;
  });
}
export function benchmark(before: AssessmentDetail, after: AssessmentDetail) {
  const beforeNames = before.pages.map((p) => p.url.split('/').pop());
  const afterNames = after.pages.map((p) => p.url.split('/').pop());
  const pages = beforeNames.filter((n) => afterNames.includes(n));
  const beforeFindings = before.findings.filter((f) =>
    pages.includes(
      before.pages
        .find((p) => p.id === f.pageId)
        ?.url.split('/')
        .pop(),
    ),
  );
  const afterFindings = after.findings.filter((f) =>
    pages.includes(
      after.pages
        .find((p) => p.id === f.pageId)
        ?.url.split('/')
        .pop(),
    ),
  );
  const issues = dataset.issues
    .filter((i) => pages.includes(`${i.page}.html`))
    .map((i) => {
      const eligible = beforeFindings.filter(
        (f) =>
          before.pages.find((p) => p.id === f.pageId)?.url.endsWith(`/${i.page}.html`) &&
          f.mappings.some((m) => m.requirementId === i.criterion),
      );
      const candidates = eligible.filter((f) => (rules[i.failure] ?? []).includes(f.ruleId));
      const decisions = (before.benchmarkDecisions ?? []).filter((d) => d.referenceId === i.id);
      const latest = decisions[0];
      const matched =
        latest?.outcome === 'matched' && eligible.some((f) => f.id === latest.findingId);
      return {
        ...i,
        candidateFindingIds: candidates.map((f) => f.id),
        eligibleFindings: eligible.map((f) => ({
          id: f.id,
          help: f.help,
          evidenceIds: f.evidence.map((e) => e.id),
        })),
        decisions,
        status: matched
          ? 'verified match'
          : latest?.outcome === 'rejected'
            ? 'match rejected'
            : candidates.length
              ? 'candidate match'
              : 'missed / manual review required',
      };
    });
  const candidateIds = new Set(issues.flatMap((i) => i.candidateFindingIds));
  const completed = before.status === 'completed' && after.status === 'completed';
  const verifiedNumerator = issues.filter((i) => i.status === 'verified match').length;
  const verifiedRecall = completed && issues.length ? verifiedNumerator / issues.length : null;
  return {
    methodology: dataset.unit,
    version: dataset.version,
    completed,
    pages,
    beforeFindingCount: beforeFindings.length,
    afterFindingCount: afterFindings.length,
    denominator: issues.length,
    candidateNumerator: issues.filter((i) => i.candidateFindingIds.length).length,
    verifiedNumerator,
    verifiedRecall,
    unverifiedReferenceUnits: issues.length - verifiedNumerator,
    referenceUnitsWithoutCandidate: issues.filter((i) => !i.candidateFindingIds.length).length,
    validatedFalsePositives: {
      count: afterFindings.filter((f) =>
        after.tasks.some(
          (t) =>
            t.findingId === f.id &&
            t.status === 'resolved' &&
            t.decisions[0]?.outcome === 'rejected',
        ),
      ).length,
      adjudicated: afterFindings.filter((f) =>
        after.tasks.some((t) => t.findingId === f.id && t.status === 'resolved'),
      ).length,
      totalCandidates: afterFindings.length,
    },
    automatedDetectionCoverage: {
      candidateUnits: issues.filter((i) => i.candidateFindingIds.length).length,
      totalReferenceUnits: issues.length,
      meaning: 'Provisional category association, not validated instance recall',
    },
    humanReviewCoverage: {
      resolvedCriterionTasks: before.tasks.filter(
        (t) => t.kind === 'criterion' && t.status === 'resolved',
      ).length,
      totalCriterionTasks: before.tasks.filter((t) => t.kind === 'criterion').length,
    },
    issues,
    unmatchedBefore: beforeFindings.filter((f) => !candidateIds.has(f.id)).map((f) => f.id),
    afterFalsePositiveCandidates: afterFindings.map((f) => f.id),
    humanReview: {
      before: before.tasks.filter((t) => t.status === 'resolved').length,
      after: after.tasks.filter((t) => t.status === 'resolved').length,
    },
    targetAchieved: verifiedRecall !== null && verifiedRecall >= 0.9,
    warning:
      'Candidate associations use page, criterion and a conservative rule-to-failure mapping. Only saved human reference adjudications count as verified category discovery. This metric does not establish instance-level recall or precision. After findings require investigation; they are not proven false positives.',
  };
}
