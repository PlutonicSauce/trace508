import { db } from './db';
import { z } from 'zod';
import { evidenceHash, stableId } from './ids';
export const decisionSchema = z.object({
  reviewer: z.string().trim().min(2).max(500),
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
});
export async function saveDecision(id: string, value: unknown) {
  const data = decisionSchema.parse(value);
  return db.$transaction(async (tx) => {
    // Serialize reviewer edits to keep the latest decision and task status consistent.
    await tx.$queryRaw`SELECT id FROM "ReviewTask" WHERE id=${id} FOR UPDATE`;
    const task = await tx.reviewTask.findUniqueOrThrow({
      where: { id },
      include: { assessment: true },
    });
    if (task.assessment.status !== 'completed')
      throw new Error('Complete the scan before recording a reviewer decision.');
    const valid =
      task.kind === 'criterion'
        ? ['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'reopen']
        : ['confirmed', 'rejected', 'reopen'];
    if (!valid.includes(data.outcome))
      throw new Error('Outcome does not match the review task type.');
    const evidence = await tx.evidence.findMany({
      where: { id: { in: data.evidenceIds }, pageId: task.pageId },
    });
    if (evidence.length !== new Set(data.evidenceIds).size)
      throw new Error('Evidence must belong to this page.');
    if (task.kind === 'criterion' && data.outcome !== 'reopen' && !data.observation)
      throw new Error(
        'Criterion decisions require a documented human observation with test steps and result.',
      );
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
            taskId: id,
            outcome: data.outcome,
            observation: data.observation,
          },
          sha256: evidenceHash({
            reviewer: data.reviewer,
            taskId: id,
            outcome: data.outcome,
            observation: data.observation,
          }),
          hashScheme: 'canonical-json-sha256-v1',
        },
      });
      ids.push(eid);
    }
    if (data.outcome !== 'reopen' && !ids.length)
      throw new Error('A decision requires scanner evidence or a documented observation.');
    const decision = await tx.reviewerDecision.create({
      data: {
        taskId: id,
        reviewer: data.reviewer,
        outcome: data.outcome,
        notes: data.notes,
        evidenceIds: ids,
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
        detail: `${task.kind} ${id}: ${data.outcome}; ${data.notes}`,
      },
    });
    return decision;
  });
}
