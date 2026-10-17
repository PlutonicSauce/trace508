import {
  Document,
  BorderStyle,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { assertStorageBudget } from './quotas';
import { AppError } from './errors';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openacrDocument, reportChanges } from './openacr';
import { redactConfiguration } from './privacy';
import { localPath } from './storage';
import { db } from './db';
import { getAssessment, matrix } from './assessment';
import { hash } from './ids';
import chapters from '../../../data/vpat-chapters.json' with { type: 'json' };
const p = (text: string) =>
  new Paragraph({ children: [new TextRun({ text, size: 20 })], spacing: { after: 100 } });
const h = (text: string) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 120 } });
const table = (rows: string[][]) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2200, 1500, 5600],
    borders: Object.fromEntries(
      ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map((side) => [
        side,
        { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
      ]),
    ),
    rows: rows.map(
      (r, index) =>
        new TableRow({
          tableHeader: index === 0,
          cantSplit: true,
          children: r.map(
            (text, col) =>
              new TableCell({
                width: { size: [2200, 1500, 5600][col], type: WidthType.DXA },
                shading: { fill: index === 0 ? 'E7EDF2' : index % 2 ? 'FFFFFF' : 'F6F8FA' },
                margins: { top: 100, bottom: 100, left: 100, right: 100 },
                children: [p(text)],
              }),
          ),
        }),
    ),
  });
export async function generateReport(
  id: string,
  author = { name: 'Trace508 local service', email: '', actor: 'local-service' },
) {
  const a = await getAssessment(id);
  if (!a) throw new Error('Assessment not found');
  if (a.status !== 'completed') throw new Error('A draft report requires a completed scan.');
  await assertStorageBudget(a.projectId, 10000000);
  const rs = await db.requirement.findMany({ orderBy: { id: 'asc' } }),
    rows = matrix(a, rs);
  const observations = await db.evidence.findMany({
    where: { page: { assessmentId: id }, kind: { startsWith: 'human-' } },
  });
  const project = await db.project.findUniqueOrThrow({
    where: { id: a.projectId },
    include: { organization: true },
  });
  const seriesId = a.rootId ?? a.id;
  const rootAssessment = await db.assessment.findUnique({ where: { id: seriesId } });
  const productName = rootAssessment?.name ?? a.name;
  const previous = await db.report.findFirst({ where: { seriesId }, orderBy: { version: 'desc' } });
  const manifest = [
    ...a.findings.flatMap((f) => f.evidence),
    ...a.pages.flatMap((p) => p.evidence),
    ...observations,
  ].map((e) => ({
    id: e.id,
    pageId: e.pageId,
    kind: e.kind,
    sha256: e.sha256,
    summary: e.summary,
  }));
  const snapshot = JSON.parse(
    JSON.stringify({
      assessment: {
        id: a.id,
        name: a.name,
        url: a.url,
        createdAt: a.createdAt,
        projectId: a.projectId,
        buildLabel: a.buildLabel,
        configuration: redactConfiguration(a.configuration),
        pages: a.pages.map((p) => ({ id: p.id, url: p.url })),
        scanRuns: a.runs.map((r) => ({
          id: r.id,
          scannerVersion: r.scannerVersion,
          browserVersion: r.browserVersion,
          configuration: r.configuration,
          completedAt: r.completedAt,
        })),
      },
      productName,
      findingKeys: a.findings.map(
        (f) =>
          `${f.ruleId} | ${a.pages.find((p) => p.id === f.pageId)?.url} | ${a.pages.find((p) => p.id === f.pageId)?.stateKey}`,
      ),
      matrix: rows,
      remediation: await db.remediation.findMany({
        where: {
          finding: {
            assessment: { projectId: a.projectId, OR: [{ id: seriesId }, { rootId: seriesId }] },
          },
        },
        include: {
          events: true,
          retests: true,
          finding: { select: { id: true, assessmentId: true, pageId: true, ruleId: true } },
        },
      }),
      journeySteps: a.journeySteps,
      manifest,
      decisions: a.tasks.flatMap((t) => t.decisions),
      chapterApplicability:
        'Unresolved. Chapter 3 functional performance, Chapter 4 hardware, Chapter 5 software and Chapter 6 support documentation/services require scope review.',
      generatedAt: new Date().toISOString(),
    }),
  );
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: 'Draft Accessibility Conformance Report', heading: HeadingLevel.TITLE }),
    p('Revised Section 508 Edition evaluation working draft'),
    p(`Product: ${productName}`),
    p(`Draft report version ${(previous?.version ?? 0) + 1}`),
    p(`Report date: ${new Date().toISOString().slice(0, 10)}`),
    p(`Assessed URL: ${a.url}`),
    p(`Assessment ID: ${a.id}`),
    p(
      `Organization: ${project.organization.name}. Report author: ${author.name}${author.email ? ' <' + author.email + '>' : ''}`,
    ),
    p(
      `Living report series ${seriesId}. Source build: ${a.buildLabel ?? 'External build version not supplied'}`,
    ),
    p(
      `Description: Scoped accessibility assessment of ${a.url}${a.journeyId ? ' including the configured user journey' : ''}. ${project.isFixture || a.variant === 'lab' ? 'CONTROLLED TEST FIXTURE evaluation.' : ''}`,
    ),
    h('Evaluation methods and scope'),
    p(
      `Automated: ${a.runs.map((r) => r.scannerVersion).join(', ')}. WCAG 2.0 Level A and AA. Human: only saved reviewer decisions and documented observations listed in the evidence manifest. Scope: ${a.pages.map((p) => p.url).join(', ')}.`,
    ),
    p(
      'DRAFT ONLY. Incomplete evaluation. This is a review working document informed by ITI VPAT® 2.5Rev 508 (April 2025), not a completed official VPAT® or procurement-ready ACR. Blank conformance cells require human evaluation. No automated pass establishes conformance. Product scope and additional Section 508 chapters require ratification.',
    ),
    h('Conformance terminology'),
    p(
      'Supports; Partially Supports; Does Not Support; Not Applicable. Only saved evidence-backed criterion decisions can populate conformance cells. Unresolved draft cells remain blank. Not Evaluated is not used as an A/AA conformance term.',
    ),
  ];
  for (const level of ['A', 'AA'])
    children.push(
      h(`Success Criteria Level ${level}`),
      table([
        ['Criteria', 'Conformance Level', 'Remarks and Explanations'],
        ...rows
          .filter((r) => r.level === level)
          .map((r) => [
            `${r.id} ${r.title}`,
            r.conclusion ?? '',
            `${r.ready ? 'Saved reviewer decisions for the scoped pages.' : 'DRAFT: human evaluation or ratification outstanding.'} Automated: ${r.automated}. Findings: ${r.findings.join(', ') || 'none recorded'}. Evidence: ${r.evidenceIds.length ? `${r.evidenceIds.slice(0, 3).join(', ')}${r.evidenceIds.length > 3 ? `; plus ${r.evidenceIds.length - 3} node records in companion manifest` : ''}` : 'see page scan evidence and reviewer manifest'}. ${a.tasks
              .filter((t) => t.requirementId === r.id)
              .flatMap((t) => t.decisions.slice(0, 1))
              .map((d) => `${d.reviewer}: ${d.notes} [${(d.evidenceIds as string[]).join(', ')}]`)
              .join(' ')}`,
          ]),
      ]),
    );
  children.push(
    h('Revised Section 508 chapters'),
    p(snapshot.chapterApplicability),
    table([
      ['Criteria', 'Conformance Level', 'Remarks and Explanations'],
      ...chapters.map((label) => [
        label,
        '',
        'DRAFT: applicability and evidence require report owner review. No Not Applicable assertion has been made.',
      ]),
    ]),
    h('Evidence manifest'),
    ...manifest
      .filter((e) => e.kind !== 'axe-node')
      .flatMap((e) => [
        p(`${e.id} · ${e.kind} · page ${e.pageId}`),
        p(`SHA-256: ${e.sha256}`),
        p(e.summary.slice(0, 1000)),
      ]),
    h('Sources'),
    p(
      'Download the companion JSON manifest for every node evidence ID, hash and reviewer decision. Raw scanner evidence remains in the assessment evidence workspace.',
    ),
    p('https://www.itic.org/policy/accessibility/vpat'),
    p('https://www.section508.gov/sell/how-to-create-acr-with-vpat/'),
    p('https://www.w3.org/TR/WCAG20/'),
    p('https://ictbaseline.access-board.gov/web-baselines/'),
  );
  const document = new Document({
    creator: 'Trace508',
    title: `Draft ACR - ${a.name}`,
    description: 'Evidence-backed draft with unresolved conformance cells',
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 20, color: '000000', language: { value: 'en-US' } },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          run: { size: 36, bold: true, color: '000000' },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          run: { size: 26, bold: true, color: '000000' },
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1080, right: 900, bottom: 1080, left: 900 } } },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(document),
    digest = hash(buffer);
  const directory = localPath('reports');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${id}-${randomUUID()}.docx`);
  await writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
  const report = await db
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${seriesId}))`;
      const prior = await tx.report.findFirst({
        where: { seriesId },
        orderBy: { version: 'desc' },
      });
      if ((prior?.version ?? 0) !== (previous?.version ?? 0))
        throw new AppError(
          409,
          'REPORT_CHANGED',
          'Report history changed during export. Generate a fresh version.',
        );
      const version = (prior?.version ?? 0) + 1;
      const generated = author.email ? openacrDocument(snapshot, author, version) : null;
      const changes = reportChanges(prior?.snapshot ?? null, snapshot);
      const report = await tx.report.create({
        data: {
          assessmentId: id,
          seriesId,
          version,
          previousId: prior?.id,
          changes: JSON.parse(JSON.stringify(changes)),
          openacr: generated ? JSON.parse(JSON.stringify(generated.document)) : undefined,
          openacrValidation: generated?.validation,
          snapshot,
          sha256: digest,
          path: file,
        },
      });
      await tx.auditEvent.create({
        data: {
          assessmentId: id,
          action: 'draft-report-generated',
          actor: author.actor,
          detail: `Report v${version} ${report.id}, SHA-256 ${digest}. ${rows.filter((r) => !r.ready).length} unresolved WCAG criteria; chapter applicability unresolved. OpenACR ${generated ? 'schema validated' : 'not exported: author contact missing'}.`,
        },
      });
      return report;
    })
    .catch(async (error) => {
      await rm(file, { force: true });
      throw error;
    });
  return report;
}
