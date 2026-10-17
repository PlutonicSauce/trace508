import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import path from 'node:path';
import { root } from './storage';
const catalog = parse(readFileSync(path.join(root, 'data/openacr-catalog-2.4-508.yaml'), 'utf8'));
import schema from '../../../data/openacr-0.1.0.schema.json' with { type: 'json' };
import { hash } from './ids';
const validator = new Ajv({ allErrors: true, strict: false }).compile(schema);
const terms: Record<string, string> = {
  Supports: 'supports',
  'Partially Supports': 'partially-supports',
  'Does Not Support': 'does-not-support',
  'Not Applicable': 'not-applicable',
};
export function openacrDocument(
  snapshot: any,
  author: { name: string; email: string },
  version: number,
) {
  const chapters: Record<string, unknown> = {};
  const expected = catalog.chapters
    .filter((c: any) => ['success_criteria_level_a', 'success_criteria_level_aa'].includes(c.id))
    .flatMap((c: any) => c.criteria.map((r: any) => String(r.id)));
  if (
    snapshot.matrix.length !== 38 ||
    expected.some((id: string) => !snapshot.matrix.some((r: any) => r.id === id))
  )
    throw new Error('OpenACR criterion catalog validation failed.');
  for (const level of ['A', 'AA'])
    chapters[level === 'A' ? 'success_criteria_level_a' : 'success_criteria_level_aa'] = {
      notes:
        'Draft WCAG 2.0 web scope. Omitted adherence fields are unresolved; they are not passing claims.',
      criteria: snapshot.matrix
        .filter((r: any) => r.level === level)
        .map((r: any) => ({
          num: r.id,
          components: [
            {
              name: 'web',
              ...(r.conclusion && !r.integrityError
                ? {
                    adherence: {
                      level: terms[r.conclusion],
                      notes: `Saved human criterion decisions. Evidence IDs: ${r.evidenceIds.join(', ')}. See companion manifest and decision history.`,
                    },
                  }
                : {}),
            },
          ],
        })),
    };
  const integrityWarnings = snapshot.matrix.filter((r: any) => r.integrityError);
  const doc = {
    title: `${snapshot.assessment.name} Accessibility Conformance Report`,
    product: {
      name: snapshot.productName ?? snapshot.assessment.name,
      description: `Scoped evaluation of ${snapshot.assessment.url}`,
    },
    author,
    report_date: snapshot.generatedAt.slice(0, 10),
    last_modified_date: snapshot.generatedAt.slice(0, 10),
    version,
    catalog: '2.4-edition-wcag-2.0-508-en',
    notes:
      'INCOMPLETE DRAFT. Additional Section 508 chapter applicability remains unresolved. No procurement-ready or organizational approval is asserted. Unresolved criteria deliberately omit adherence. ' +
      (integrityWarnings.length
        ? `INTEGRITY WARNING: Conformance conclusions withheld for ${integrityWarnings.length} criteria due to unsupported or mismatched evidence: ${integrityWarnings.map((r: any) => r.id).join(', ')}. `
        : '') +
      snapshot.chapterApplicability,
    evaluation_methods_used: snapshot.assessment.scanRuns
      .map((r: any) => `${r.scannerVersion}; browser ${r.browserVersion ?? 'not recorded'}`)
      .join('; '),
    chapters,
  };
  if (!validator(doc))
    throw new Error('OpenACR schema validation failed: ' + JSON.stringify(validator.errors));
  for (const c of Object.values(chapters) as any[])
    for (const r of c.criteria)
      for (const component of r.components)
        if (component.adherence && !Object.values(terms).includes(component.adherence.level))
          throw new Error('Unsupported conformance term');
  return {
    document: doc,
    validation: {
      valid: true,
      schema: 'GSA/openacr schema/openacr-0.1.0.json',
      schemaSha256: hash(readFileSync(path.join(root, 'data/openacr-0.1.0.schema.json'))),
      source: 'https://raw.githubusercontent.com/GSA/openacr/main/schema/openacr-0.1.0.json',
      semanticChecks: [
        'only official mapped terms',
        'unresolved adherence omitted',
        '38 WCAG 2.0 A/AA criteria',
      ],
      scope: 'Schema-valid partial draft, not catalog-complete or ratified',
    },
  };
}
export function reportChanges(previous: any | null, current: any) {
  if (!previous)
    return {
      kind: 'initial-version',
      addedFindings: current.findingKeys ?? [],
      removedFindings: [],
      newEvidence: current.manifest.map((e: any) => e.id),
      changedCriteria: [],
    };
  const old = new Set<string>(previous.findingKeys ?? []),
    next = new Set<string>(current.findingKeys ?? []);
  return {
    kind: 'new-evidence-version',
    addedFindings: [...next].filter((x) => !old.has(x)),
    removedFindings: [...old].filter((x) => !next.has(x)),
    newEvidence: current.manifest
      .filter((e: any) => !previous.manifest.some((p: any) => p.id === e.id))
      .map((e: any) => e.id),
    changedCriteria: current.matrix
      .filter(
        (r: any) => previous.matrix.find((p: any) => p.id === r.id)?.conclusion !== r.conclusion,
      )
      .map((r: any) => r.id),
    previousAssessmentId: previous.assessment.id,
    currentAssessmentId: current.assessment.id,
  };
}
