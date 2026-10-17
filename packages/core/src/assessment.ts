import { db } from './db';
import { validateUrl, resolvePublicHost } from './security';
import { stableId, evidenceHash } from './ids';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';
import { assertStorageBudget } from './quotas';
export const newAssessment = z.object({
  name: z.string().trim().min(3).max(100),
  url: z.string().url().max(1000),
  pages: z.number().int().min(1).max(4).default(1),
  urls: z.array(z.string().url().max(1000)).max(4).optional(),
  targetId: z.string().optional(),
  journeyId: z.string().optional(),
});
export async function createAssessment(
  input: unknown,
  projectId = 'default',
  actor = 'local-service',
  parentId?: string,
  defer = false,
  requestKey?: string,
) {
  const data = newAssessment.parse(input);
  const targets = await db.target.findMany({ where: { projectId, enabled: true } });
  const target = data.targetId
    ? targets.find((t) => t.id === data.targetId)
    : targets.find((t) => {
        try {
          validateUrl(data.url, false, t);
          return true;
        } catch {
          return false;
        }
      });
  if (data.targetId && !target)
    throw new Error('Destination target is not permitted in this project.');
  const u = validateUrl(data.url, false, target);
  if (!target?.lab) await resolvePublicHost(u.hostname);
  const journey = data.journeyId
    ? await db.journey.findFirstOrThrow({
        where: { id: data.journeyId, projectId, targetId: target?.id },
      })
    : null;
  if (journey && !target) throw new Error('Journey requires an approved target.');
  const id = randomUUID(),
    variant =
      u.hostname === 'www.w3.org' && u.pathname.includes('/before/')
        ? 'before'
        : u.hostname === 'www.w3.org' && u.pathname.includes('/after/')
          ? 'after'
          : target?.lab
            ? 'lab'
            : 'custom';
  let urls = data.urls?.length ? [...new Set([u.href, ...data.urls])] : [u.href];
  if (data.pages > 1 && !data.urls && ['before', 'after'].includes(variant))
    urls = [
      u.href,
      ...['home', 'news', 'tickets', 'survey']
        .map((n) => `https://www.w3.org/WAI/demos/bad/${variant}/${n}.html`)
        .filter((v) => v !== u.href),
    ].slice(0, data.pages);
  if (urls.length > 4) throw new Error('Scan scope is limited to four URLs.');
  for (const url of urls) validateUrl(url, false, target);
  if (journey && urls.length !== 1) throw new Error('Journeys require one starting URL.');
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const parent = parentId
    ? await db.assessment.findFirstOrThrow({ where: { id: parentId, projectId } })
    : null;
  await assertStorageBudget(projectId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(508)`;
    if (requestKey) {
      const prior = await tx.assessment.findUnique({
        where: { projectId_requestKey: { projectId, requestKey } },
      });
      if (prior) {
        if (prior.requestFingerprint !== evidenceHash(data))
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for a different assessment configuration.',
          );
        return prior;
      }
    }
    if (
      (await tx.assessment.count({
        where: { status: { in: ['queued', 'running', 'preparing'] } },
      })) >= 4
    )
      throw new Error('Queue is full. Wait for a scan to finish.');
    return tx.assessment.create({
      data: {
        id,
        requestKey,
        requestFingerprint: requestKey ? evidenceHash(data) : undefined,
        status: defer ? 'preparing' : 'queued',
        projectId,
        targetId: target?.id,
        journeyId: journey?.id,
        parentId: parent?.id,
        rootId: parent?.rootId ?? parent?.id ?? id,
        name: data.name,
        url: u.href,
        variant,
        configuration: JSON.parse(
          JSON.stringify({
            target: target ?? null,
            journey: journey ?? null,
            scope: urls,
            wcagTags: ['wcag2a', 'wcag2aa'],
            viewport: { width: 1440, height: 1000 },
            maxRuntimeMs: 120000,
            maxRequests: 400,
            isFixture: project.isFixture || !!target?.lab,
          }),
        ),
        expiresAt: new Date(Date.now() + project.retentionDays * 86400000),
        pages: { create: urls.map((url) => ({ id: stableId(id, url), url, stateKey: 'initial' })) },
        events: {
          create: {
            action: 'assessment-created',
            actor,
            detail: `Requested ${urls.length} page(s)${journey ? ' and journey ' + journey.name : ''}; ${target?.lab ? 'controlled fixture' : 'permitted external target'}`,
          },
        },
      },
    });
  });
}
export async function getAssessment(id: string) {
  const result = await db.assessment.findUnique({
    where: { id },
    include: {
      journeySteps: { orderBy: { index: 'asc' } },
      packages: true,
      benchmarkDecisions: { orderBy: { createdAt: 'desc' } },
      pages: { include: { evidence: { where: { kind: 'scan' } } } },
      runs: true,
      findings: {
        include: {
          evidence: true,
          mappings: { include: { requirement: true } },
          remediation: {
            include: {
              events: { orderBy: { createdAt: 'desc' } },
              retests: {
                include: { assessment: { select: { id: true, status: true, name: true } } },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      tasks: {
        include: { requirement: true, page: true, decisions: { orderBy: { createdAt: 'desc' } } },
      },
      reports: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (result)
    result.reports = await db.report.findMany({
      where: { OR: [{ assessmentId: result.id }, { seriesId: result.rootId ?? result.id }] },
      orderBy: { createdAt: 'desc' },
    });
  return result;
}
export type AssessmentDetail = NonNullable<Awaited<ReturnType<typeof getAssessment>>>;
export function matrix(
  a: AssessmentDetail,
  rs: {
    id: string;
    title: string;
    level: string;
    source: string;
    section508: string;
    reviewGuide: string;
  }[],
) {
  // Map evidence IDs from automated findings to their mapped requirements
  const evidenceToFinding = new Map<
    string,
    { findingId: string; ruleId: string; requirements: string[] }
  >();
  for (const f of a.findings ?? []) {
    const reqs = f.mappings?.map((m) => m.requirementId) ?? [];
    for (const e of f.evidence ?? []) {
      evidenceToFinding.set(e.id, { findingId: f.id, ruleId: f.ruleId, requirements: reqs });
    }
  }

  return rs.map((r) => {
    const findings = (a.findings ?? []).filter((f) =>
      f.mappings?.some((m) => m.requirementId === r.id),
    );
    const tasks = (a.tasks ?? []).filter((t) => t.kind === 'criterion' && t.requirementId === r.id);

    const integrityErrors: string[] = [];
    const taskIntegrityErrors = new Set<string>();

    // Inspect each task and its decisions for integrity and invalidation
    for (const t of tasks) {
      const activeDecision = t.decisions?.find((d) => !d.invalidatedAt);
      const invalidatedDecisions = t.decisions?.filter((d) => d.invalidatedAt != null) ?? [];

      if (!activeDecision && invalidatedDecisions.length > 0) {
        const latestInv = invalidatedDecisions[0];
        integrityErrors.push(
          `Prior decision was invalidated (${latestInv.invalidationReason ?? 'review invalidation'}). Conformance conclusion withheld until re-reviewed.`,
        );
        taskIntegrityErrors.add(t.id);
        continue;
      }

      if (activeDecision) {
        const eids = Array.isArray(activeDecision.evidenceIds)
          ? (activeDecision.evidenceIds as string[])
          : [];

        // Check whether any attached evidence belongs to a finding mapped to an unrelated criterion
        for (const eid of eids) {
          const findingInfo = evidenceToFinding.get(eid);
          if (findingInfo && !findingInfo.requirements.includes(r.id)) {
            const mapped = findingInfo.requirements.map((x) => `WCAG ${x}`).join(', ') || 'none';
            const errorMsg = `Evidence ${eid} from automated rule "${findingInfo.ruleId}" maps to [${mapped}], not reviewed criterion WCAG ${r.id} (${r.title}). An automated finding cannot justify an unrelated accessibility criterion.`;
            integrityErrors.push(errorMsg);
            taskIntegrityErrors.add(t.id);
            break;
          }
        }
      }
    }

    const resolved = tasks.filter(
      (t) =>
        t.status === 'resolved' &&
        t.decisions?.[0] &&
        !t.decisions[0].invalidatedAt &&
        !taskIntegrityErrors.has(t.id),
    );
    const outcomes = resolved.map((t) => t.decisions[0].outcome);
    const contradictory =
      outcomes.some((o) => ['Supports', 'Not Applicable'].includes(o)) &&
      findings.some(
        (f) =>
          !a.tasks.some(
            (t) =>
              t.findingId === f.id &&
              t.status === 'resolved' &&
              t.decisions[0]?.outcome === 'rejected' &&
              !t.decisions[0]?.invalidatedAt,
          ),
      );
    const mixed = new Set(outcomes).size > 1;
    const hasIntegrityError = integrityErrors.length > 0;
    const ready =
      !mixed &&
      !hasIntegrityError &&
      a.status === 'completed' &&
      tasks.length === a.pages.length &&
      resolved.length === tasks.length &&
      !contradictory;

    // Per-page decisions never silently aggregate into a product-wide positive statement.
    const conclusion = ready
      ? outcomes.every((o) => o === 'Not Applicable')
        ? 'Not Applicable'
        : outcomes.every((o) => o === 'Supports' || o === 'Not Applicable')
          ? 'Supports'
          : outcomes.every((o) => o === 'Does Not Support')
            ? 'Does Not Support'
            : 'Partially Supports'
      : null;

    return {
      ...r,
      findings: findings.map((f) => f.id),
      evidenceIds: [
        ...new Set([
          ...findings.flatMap((f) => f.evidence.map((e) => e.id)),
          ...resolved.flatMap((t) =>
            Array.isArray(t.decisions[0]?.evidenceIds)
              ? (t.decisions[0].evidenceIds as string[]).filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
          ),
        ]),
      ],
      automated: findings.length
        ? 'violations observed'
        : a.status === 'completed'
          ? 'no violation observed / limited coverage'
          : 'scan incomplete',
      reviewOpen: tasks.length - resolved.length,
      conclusion,
      ready,
      contradictory,
      integrityError: hasIntegrityError ? integrityErrors.join('; ') : null,
      invalidatedDecisions: tasks.flatMap((t) =>
        (t.decisions ?? [])
          .filter((d) => d.invalidatedAt != null)
          .map((d) => ({
            id: d.id,
            taskId: t.id,
            reviewer: d.reviewer,
            invalidatedAt: d.invalidatedAt,
            invalidationReason: d.invalidationReason,
          })),
      ),
    };
  });
}

export async function retryAssessment(id: string, projectId: string, actor: string) {
  const a = await db.assessment.findFirstOrThrow({ where: { id, projectId } });
  if (!['failed', 'cancelled'].includes(a.status))
    throw new AppError(
      409,
      'NOT_RETRYABLE',
      'Only failed or cancelled assessments can be retried.',
    );
  if (a.attempt >= 3)
    throw new AppError(
      409,
      'RETRY_EXHAUSTED',
      'Three attempts exhausted. Investigate the cause before creating a new assessment.',
    );
  const config = a.configuration as { scope?: string[] };
  const next = await createAssessment(
    {
      name: `Retry ${a.attempt + 1} · ${a.name}`.slice(0, 100),
      url: a.url,
      urls: a.journeyId ? undefined : config.scope,
      targetId: a.targetId ?? undefined,
      journeyId: a.journeyId ?? undefined,
    },
    projectId,
    actor,
    id,
    true,
  );
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Assessment" WHERE id=${id} FOR UPDATE`;
    if (await tx.assessment.count({ where: { retryOf: id } }))
      throw new AppError(409, 'RETRY_EXISTS', 'This attempt already has a retry.');
    await tx.assessment.update({
      where: { id: next.id },
      data: { status: 'queued', retryOf: id, attempt: a.attempt + 1 },
    });
  });
  return next;
}
