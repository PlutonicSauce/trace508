import JSZip from 'jszip';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { getAssessment } from './assessment';
import { hash, canonicalJson, evidenceHash } from './ids';
import { localPath } from './storage';
import { AppError } from './errors';
import { redactConfiguration } from './privacy';
import { assertStorageBudget } from './quotas';
export async function createEvidencePackage(id: string, actor: string) {
  const a = await getAssessment(id);
  if (!a) throw new AppError(404, 'NOT_FOUND', 'Assessment not found');
  if (['queued', 'running', 'preparing'].includes(a.status))
    throw new AppError(409, 'SCAN_ACTIVE', 'Finish or stop the scan before packaging evidence.');
  await assertStorageBudget(a.projectId, 100000000);
  const lineage = await db.assessment.findMany({
    where: { projectId: a.projectId, OR: [{ id: a.rootId ?? a.id }, { rootId: a.rootId ?? a.id }] },
    orderBy: { createdAt: 'asc' },
    take: 13,
  });
  if (lineage.length > 12)
    throw new AppError(
      409,
      'PACKAGE_SCOPE',
      'Lineage exceeds twelve assessments. Export individual assessments through an operator archival procedure.',
    );
  const allEvidence = await db.evidence.findMany({
    where: { page: { assessmentId: { in: lineage.map((x) => x.id) } } },
    orderBy: { id: 'asc' },
  });
  const zip = new JSZip(),
    files: { path: string; sha256: string; bytes: number }[] = [];
  const add = (name: string, data: Buffer | string) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (files.reduce((n, f) => n + f.bytes, 0) + bytes.length > 100000000)
      throw new AppError(
        409,
        'PACKAGE_TOO_LARGE',
        'Evidence package exceeds the 100 MB uncompressed limit.',
      );
    zip.file(name, bytes);
    files.push({ path: name, sha256: hash(bytes), bytes: bytes.length });
  };
  add(
    'assessment.json',
    canonicalJson({
      ...a,
      configuration: redactConfiguration(a.configuration),
      pages: a.pages.map((p) => ({
        ...p,
        evidence: p.evidence.map((e) => ({ ...e, screenshot: undefined })),
      })),
      findings: a.findings.map((f) => ({
        ...f,
        evidence: f.evidence.map((e) => ({ ...e, screenshot: undefined })),
      })),
    }),
  );
  add(
    'requirements.json',
    canonicalJson(await db.requirement.findMany({ orderBy: { id: 'asc' } })),
  );
  add('evidence.json', canonicalJson(allEvidence.map((e) => ({ ...e, screenshot: undefined }))));
  const lineageDetails = [];
  for (const item of lineage) {
    const detail = await getAssessment(item.id);
    if (!detail) continue;
    if (['queued', 'running', 'preparing'].includes(detail.status))
      throw new AppError(
        409,
        'LINEAGE_ACTIVE',
        'Wait for all related scans before packaging lineage.',
      );
    lineageDetails.push({ ...detail, configuration: redactConfiguration(detail.configuration) });
    for (const p of detail.pages) {
      const evidence = allEvidence.filter((e) => e.pageId === p.id);
      for (const suffix of ['axe.json', 'png', 'html']) {
        const name = `${p.id}.${suffix}`,
          file = localPath('evidence', detail.id, name);
        let data: Buffer;
        try {
          data = await readFile(file);
        } catch {
          if (
            evidence.some((e) => e.kind === 'scan') &&
            (suffix !== 'html' || evidence.some((e) => e.kind === 'dom-snapshot'))
          )
            throw new AppError(
              409,
              'ARTIFACT_MISSING',
              `Source artifact missing for page ${p.id}.`,
            );
          continue;
        }
        const scan = evidence.find((e) => e.kind === 'scan');
        if (suffix === 'axe.json' && scan) {
          const value = JSON.parse(data.toString());
          const digest =
            scan.hashScheme === 'canonical-json-sha256-v1' ? evidenceHash(value) : hash(value);
          if (digest !== scan.sha256)
            throw new AppError(409, 'INTEGRITY_FAILURE', 'Source scanner hash mismatch.');
        }
        if (suffix === 'png' && scan?.screenshotSha256 && hash(data) !== scan.screenshotSha256)
          throw new AppError(409, 'INTEGRITY_FAILURE', 'Screenshot hash mismatch.');
        const dom = evidence.find((e) => e.kind === 'dom-snapshot');
        if (suffix === 'html' && dom) {
          const payload = dom.payload as { html: string; url: string };
          if (data.toString() !== payload.html || evidenceHash(payload) !== dom.sha256)
            throw new AppError(409, 'INTEGRITY_FAILURE', 'DOM hash mismatch.');
        }
        add(`source/${name}`, data);
      }
    }
  }
  add('lineage.json', canonicalJson(lineageDetails));
  const manifest = {
    format: 'trace508-evidence-package-v1',
    assessmentId: id,
    createdAt: new Date().toISOString(),
    hashAlgorithm: 'SHA-256',
    signing: 'Not signed. Hashes detect modifications; no signer identity is asserted.',
    legacyHashNotes:
      'Legacy source hashes reflect original JSON serialization. New canonical-json-sha256-v1 hashes use sorted object keys. File hashes below cover exact archive bytes.',
    files,
  };
  add('manifest.json', JSON.stringify(manifest, null, 2));
  add(
    'VERIFY.txt',
    'Use scripts/verify-package.py on this ZIP. The manifest lists SHA-256 hashes for every content file. Compare the archive SHA-256 with the separately saved database/download digest. Hashes are not signatures.',
  );
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    pid = randomUUID();
  await mkdir(localPath('packages'), { recursive: true, mode: 0o700 });
  const file = localPath('packages', `${pid}.zip`);
  await writeFile(file, data, { flag: 'wx', mode: 0o600 });
  const p = await db.evidencePackage
    .create({
      data: {
        id: pid,
        assessmentId: id,
        path: file,
        sha256: hash(data),
        manifest: JSON.parse(JSON.stringify(manifest)),
      },
    })
    .catch(async (e) => {
      await rm(file, { force: true });
      throw e;
    });
  await db.auditEvent.create({
    data: {
      assessmentId: id,
      actor,
      action: 'evidence-package-created',
      detail: `${pid}: SHA-256 ${p.sha256}. Hash integrity only; not a signature.`,
    },
  });
  return p;
}
export async function deleteAssessment(id: string, projectId: string, actor: string) {
  const a = await db.assessment.findFirstOrThrow({
    where: { id, projectId },
    include: { reports: true, packages: true },
  });
  if (['queued', 'running', 'preparing'].includes(a.status))
    throw new AppError(
      409,
      'SCAN_ACTIVE',
      'Cancel the scan and wait for its run to stop before deleting.',
    );
  if (await db.scanRun.count({ where: { assessmentId: id, status: 'running' } }))
    throw new AppError(409, 'WORKER_ACTIVE', 'Wait for the active browser run to stop.');
  await db.$transaction(async (tx) => {
    await tx.projectEvent.create({
      data: {
        projectId,
        actor,
        action: 'assessment-deleted',
        detail: `Deleted assessment ${id} (${a.name}) with its evidence, review records and report artifacts. Retention/deletion was explicitly requested.`,
      },
    });
    await tx.findingRequirement.deleteMany({ where: { finding: { assessmentId: id } } });
    await tx.evidence.deleteMany({ where: { page: { assessmentId: id } } });
    await tx.assessment.delete({ where: { id } });
  });
  await rm(localPath('evidence', id), { recursive: true, force: true });
  for (const file of [...a.reports, ...a.packages])
    if (file.path.startsWith(localPath() + path.sep)) await rm(file.path, { force: true });
  return { deleted: true, id };
}
