import { db } from './db';
import { z } from 'zod';
import { createAssessment } from './assessment';
import { AppError } from './errors';
import { stableId, evidenceHash } from './ids';
const manualStates = ['remediation-proposed', 'implementation-claimed', 'awaiting-retest'] as const;
export async function updateRemediation(id: string, value: unknown, actor: string) {
  const d = z
    .object({ status: z.enum(manualStates), notes: z.string().trim().min(15).max(3000) })
    .parse(value);
  return db.$transaction(async (tx) => {
    const r = await tx.remediation.findUniqueOrThrow({ where: { id } });
    if (
      ['verified-resolved', 'regressed'].includes(r.status) &&
      d.status === 'implementation-claimed'
    )
      throw new AppError(
        409,
        'RETEST_REQUIRED',
        'Preserve the resolution or regression history and run a new retest.',
      );
    await tx.remediationEvent.create({
      data: { remediationId: id, status: d.status, actor, notes: d.notes },
    });
    return tx.remediation.update({ where: { id }, data: { status: d.status } });
  });
}
export async function requestRetest(id: string, actor: string) {
  const r = await db.remediation.findUniqueOrThrow({
    where: { id },
    include: { finding: { include: { assessment: { include: { pages: true } } } } },
  });
  const base = r.finding.assessment;
  const active = await db.remediationRetest.findFirst({
    where: { remediationId: id, outcome: 'awaiting-retest' },
  });
  if (active)
    throw new AppError(409, 'RETEST_ACTIVE', 'This issue already has a queued or running retest.');
  const a = await createAssessment(
    {
      name: `Retest · ${base.name}`.slice(0, 100),
      url: base.url,
      urls: base.journeyId
        ? undefined
        : base.pages.filter((p) => p.stateKey === 'initial').map((p) => p.url),
      targetId: base.targetId ?? undefined,
      journeyId: base.journeyId ?? undefined,
    },
    base.projectId,
    actor,
    base.id,
    true,
  );
  await db.$transaction([
    db.assessment.update({ where: { id: a.id }, data: { status: 'queued' } }),
    db.remediationRetest.create({ data: { remediationId: id, assessmentId: a.id } }),
    db.remediation.update({ where: { id }, data: { status: 'awaiting-retest' } }),
    db.remediationEvent.create({
      data: {
        remediationId: id,
        status: 'awaiting-retest',
        actor,
        notes: `Independent scan queued: ${a.id}. Clicking this action makes no resolution claim.`,
      },
    }),
  ]);
  return a;
}
export async function reconcileRetests(assessmentId: string) {
  const a = await db.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { pages: { include: { evidence: { where: { kind: 'scan' } } } }, findings: true },
  });
  if (['queued', 'running'].includes(a.status)) return;
  const retests = await db.remediationRetest.findMany({
    where: { assessmentId, outcome: 'awaiting-retest' },
    include: { remediation: { include: { events: true, finding: { include: { page: true } } } } },
  });
  for (const r of retests) {
    const base = r.remediation.finding;
    const p = a.pages.find((p) => p.url === base.page.url && p.stateKey === base.page.stateKey);
    const scan = p?.evidence[0]?.payload as
      | {
          passes?: { id: string }[];
          inapplicable?: { id: string }[];
          incomplete?: { id: string }[];
        }
      | undefined;
    const matched = p
      ? a.findings.filter((f) => f.pageId === p.id && f.ruleId === base.ruleId)
      : [];
    const checked =
      scan &&
      !scan.incomplete?.some((x) => x.id === base.ruleId) &&
      (scan.passes?.some((x) => x.id === base.ruleId) ||
        scan.inapplicable?.some((x) => x.id === base.ruleId));
    const outcome =
      a.status !== 'completed' || !p
        ? 'inconclusive'
        : matched.length
          ? 'detected'
          : checked
            ? 'no-longer-detected'
            : 'inconclusive';
    const status =
      outcome === 'detected'
        ? r.remediation.events.some((e) =>
            ['verified-resolved', 'automated-issue-no-longer-detected'].includes(e.status),
          )
          ? 'regressed'
          : 'open'
        : outcome === 'no-longer-detected'
          ? 'human-verification-required'
          : 'retest-inconclusive';
    const evidenceIds = p?.evidence.map((e) => e.id) ?? [];
    await db.$transaction(async (tx) => {
      await tx.remediationRetest.update({
        where: { id: r.id },
        data: {
          outcome,
          matchedFindingIds: matched.map((f) => f.id),
          completedAt: new Date(),
          explanation:
            outcome === 'no-longer-detected'
              ? 'The same rule was executed in the corresponding page/state and this violation was not detected. Human issue verification and criterion review remain required.'
              : outcome === 'detected'
                ? 'The original rule still has violations in the corresponding page/state. Original evidence is preserved.'
                : 'The scan failed, state was not reached, or the rule outcome was inconclusive. No resolution established.',
        },
      });
      await tx.remediationEvent.create({
        data: {
          remediationId: r.remediationId,
          status: 'retest-completed',
          actor: 'scan-worker',
          notes: `Independent assessment ${assessmentId}: ${outcome}`,
          evidenceIds,
        },
      });
      if (outcome === 'no-longer-detected')
        await tx.remediationEvent.create({
          data: {
            remediationId: r.remediationId,
            status: 'automated-issue-no-longer-detected',
            actor: 'scan-worker',
            notes: 'Limited automated rule result. No criterion conformance approval.',
            evidenceIds,
          },
        });
      await tx.remediation.update({ where: { id: r.remediationId }, data: { status } });
      await tx.remediationEvent.create({
        data: {
          remediationId: r.remediationId,
          status,
          actor: 'scan-worker',
          notes:
            outcome === 'detected'
              ? 'Reopened after independent retest detected the same rule.'
              : 'Human verification is required for any resolution.',
          evidenceIds,
        },
      });
    });
  }
}
export async function verifyRemediation(id: string, value: unknown, actor: string) {
  const d = z
    .object({
      notes: z.string().trim().min(50).max(6000),
      outcome: z.enum(['verified-resolved', 'reopened']),
    })
    .parse(value);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Remediation" WHERE id=${id} FOR UPDATE`;
    const r = await tx.remediation.findUniqueOrThrow({
        where: { id },
        include: {
          finding: { include: { page: true } },
          retests: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      last = r.retests[0];
    if (d.outcome === 'verified-resolved' && (!last || last.outcome !== 'no-longer-detected'))
      throw new AppError(
        409,
        'NO_CLEAN_RETEST',
        'A completed independent retest with no detection is required before human resolution.',
      );
    if (!last)
      throw new AppError(409, 'NO_RETEST', 'Run an independent retest before verification.');
    const a = await tx.assessment.findUniqueOrThrow({ where: { id: last.assessmentId } });
    if (a.status !== 'completed')
      throw new AppError(409, 'RETEST_INCOMPLETE', 'Complete the independent retest first.');
    const p = await tx.page.findFirstOrThrow({
        where: { assessmentId: a.id, url: r.finding.page.url, stateKey: r.finding.page.stateKey },
      }),
      eid = stableId(id, actor, Date.now().toString(), d.notes);
    await tx.evidence.create({
      data: {
        id: eid,
        pageId: p.id,
        kind: 'human-remediation-verification',
        summary: d.notes,
        payload: {
          actor,
          remediationId: id,
          retestId: last.id,
          outcome: d.outcome,
          observation: d.notes,
        },
        sha256: evidenceHash({
          actor,
          remediationId: id,
          retestId: last.id,
          outcome: d.outcome,
          observation: d.notes,
        }),
        hashScheme: 'canonical-json-sha256-v1',
      },
    });
    await tx.remediationEvent.create({
      data: { remediationId: id, status: d.outcome, actor, notes: d.notes, evidenceIds: [eid] },
    });
    await tx.auditEvent.create({
      data: {
        assessmentId: a.id,
        actor,
        action: 'human-remediation-verification',
        detail: `${id}: ${d.outcome}; evidence ${eid}. Criterion conformance remains a separate decision.`,
      },
    });
    return tx.remediation.update({ where: { id }, data: { status: d.outcome } });
  });
}
