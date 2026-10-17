import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
import { validateUrl } from './security';
export const stepSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    action: z.enum(['goto', 'fill', 'click', 'press', 'check']),
    selector: z.string().min(1).max(200).optional(),
    value: z.string().max(200).optional(),
    url: z.string().url().max(1000).optional(),
    scan: z.boolean().default(true),
  })
  .strict();
export const journeySchema = z.object({
  name: z.string().trim().min(3).max(100),
  targetId: z.string(),
  allowSubmission: z.boolean().default(false),
  steps: z.array(stepSchema).min(1).max(12),
});
export type JourneyStep = z.infer<typeof stepSchema>;
export async function createJourney(projectId: string, value: unknown) {
  const data = journeySchema.parse(value);
  const target = await db.target.findFirstOrThrow({
    where: { id: data.targetId, projectId, enabled: true },
  });
  if (data.allowSubmission && !target.allowSubmission)
    throw new AppError(
      400,
      'SUBMISSION_DISABLED',
      'Target policy does not permit form submissions.',
    );
  for (const s of data.steps) {
    if (s.action === 'goto') {
      if (!s.url) throw new AppError(400, 'INVALID_STEP', 'Navigation steps require a URL.');
      validateUrl(s.url, false, target);
    } else if (!s.selector)
      throw new AppError(400, 'INVALID_STEP', 'Interaction steps require a selector.');
    if (
      s.action === 'press' &&
      ![
        'Tab',
        'Shift+Tab',
        'Enter',
        'Space',
        'Escape',
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
      ].includes(s.value ?? '')
    )
      throw new AppError(400, 'INVALID_KEY', 'Only configured navigation keys are permitted.');
  }
  return db.journey.create({
    data: { ...data, steps: JSON.parse(JSON.stringify(data.steps)), projectId },
  });
}
