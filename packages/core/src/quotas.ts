import { readdir, stat } from 'node:fs/promises';
import { db } from './db';
import { localPath } from './storage';
import { AppError } from './errors';
export async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  try {
    for (const e of await readdir(directory, { withFileTypes: true })) {
      const p = directory + '/' + e.name;
      if (e.isSymbolicLink()) continue;
      total += e.isDirectory() ? await directoryBytes(p) : (await stat(p)).size;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  return total;
}
export async function projectStorageBytes(projectId: string) {
  const records = await db.assessment.findMany({
    where: { projectId },
    select: { id: true, reports: { select: { path: true } }, packages: { select: { path: true } } },
  });
  let bytes = 0;
  for (const a of records) {
    bytes += await directoryBytes(localPath('evidence', a.id));
    for (const f of [...a.reports, ...a.packages]) {
      try {
        bytes += (await stat(f.path)).size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  return bytes;
}
export async function assertStorageBudget(projectId: string, additionalBytes = 64000000) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const used = await projectStorageBytes(projectId);
  if (used + additionalBytes > project.storageQuotaMb * 1024 * 1024)
    throw new AppError(
      409,
      'STORAGE_QUOTA',
      'Project storage budget exceeded. Export and delete expired evidence or increase the administrator quota.',
    );
  // Global artifact quota includes orphaned/legacy files, excluding the native PostgreSQL data tree.
  let global = 0;
  for (const dir of ['evidence', 'reports', 'packages'])
    global += await directoryBytes(localPath(dir));
  if (global + additionalBytes > Number(process.env.ARTIFACT_QUOTA_MB ?? 2048) * 1024 * 1024)
    throw new AppError(
      409,
      'GLOBAL_STORAGE_QUOTA',
      'Server artifact quota exceeded. Operator maintenance required.',
    );
  return { usedBytes: used, quotaMb: project.storageQuotaMb };
}
