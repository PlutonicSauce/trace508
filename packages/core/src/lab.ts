import { db } from './db';
import { z } from 'zod';
import { AppError } from './errors';
import { labOrigin } from './security';
export const labConfig = z
  .object({ imageAlt: z.boolean(), formLabels: z.boolean(), contrast: z.boolean() })
  .strict();
export async function initializeLab(projectId: string, actor: string) {
  if (process.env.ENABLE_LAB !== 'true')
    throw new AppError(
      409,
      'LAB_DISABLED',
      'The controlled fixture lab is disabled by server configuration.',
    );
  const sites = await db.labSite.findMany({ where: { projectId } });
  if (sites.length) return sites;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(50802)`;
    const existing = await tx.labSite.findMany({ where: { projectId } });
    if (existing.length) return existing;
    const result = [];
    for (const [name, config] of [
      ['Civic Benefits · image fixture', { imageAlt: false, formLabels: true, contrast: true }],
      ['Service Request · form fixture', { imageAlt: true, formLabels: false, contrast: true }],
    ] as const) {
      const site = await tx.labSite.create({
        data: {
          projectId,
          name,
          revisions: {
            create: {
              version: 1,
              config,
              actor,
              notes:
                'Controlled test fixture initialized. Defects are intentional; scanner output is not predetermined.',
            },
          },
        },
      });
      await tx.target.create({
        data: {
          projectId,
          name: `LAB: ${name}`,
          origin: labOrigin(),
          pathPrefix: `/site/${site.id}`,
          lab: true,
          allowSubmission: true,
        },
      });
      result.push(site);
    }
    await tx.projectEvent.create({
      data: {
        projectId,
        actor,
        action: 'lab-initialized',
        detail: 'Separate, controlled test websites created. No third-party content changed.',
      },
    });
    return result;
  });
}
export async function changeLab(projectId: string, id: string, value: unknown, actor: string) {
  const d = z
    .object({ config: labConfig, notes: z.string().trim().min(10).max(2000) })
    .parse(value);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LabSite" WHERE id=${id} FOR UPDATE`;
    const site = await tx.labSite.findFirstOrThrow({ where: { id, projectId } });
    const updated = await tx.labSite.update({
      where: { id },
      data: {
        revision: { increment: 1 },
        revisions: {
          create: { version: site.revision + 1, config: d.config, actor, notes: d.notes },
        },
      },
      include: { revisions: { orderBy: { version: 'desc' } } },
    });
    await tx.projectEvent.create({
      data: {
        projectId,
        actor,
        action: 'controlled-build-changed',
        detail: `${id} revision ${updated.revision}: ${d.notes}`,
      },
    });
    return updated;
  });
}
