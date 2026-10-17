import { describe, it, expect, vi } from 'vitest';
import { isPublicIp, validateUrl, assertOrigin } from '../packages/core/src/security';
import { mapTags, priority, requirements } from '../packages/core/src/requirements';
import { validateExplanation } from '../packages/core/src/ai';
import { matrix, type AssessmentDetail } from '../packages/core/src/assessment';
import { hash, stableId } from '../packages/core/src/ids';
describe('destination and request security', () => {
  it.each([
    'http://www.w3.org/WAI/demos/bad/before/home.html',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://www.w3.org.evil.test/WAI/demos/bad/before/home.html',
    'https://user:pass@www.w3.org/WAI/demos/bad/before/home.html',
    'https://www.w3.org:444/WAI/demos/bad/before/home.html',
    'https://www.w3.org/WAI/demos/bad/before/home.html?x=1',
    'https://www.w3.org/WAI/demos/bad/before/../../../../admin',
  ])('rejects unsafe URL %s', (url) => expect(() => validateUrl(url)).toThrow());
  it('accepts only approved public navigation', () =>
    expect(validateUrl('https://www.w3.org/WAI/demos/bad/before/home.html').hostname).toBe(
      'www.w3.org',
    ));
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects reserved address %s', (ip) => expect(isPublicIp(ip)).toBe(false));
  it('recognizes public IPv4', () => expect(isPublicIp('8.8.8.8')).toBe(true));
  it('rejects cross-origin mutations', () =>
    expect(() =>
      assertOrigin(
        new Request('http://127.0.0.1:3000/api/assessments', {
          headers: { origin: 'https://evil.test' },
        }),
      ),
    ).toThrow());
});
describe('traceable deterministic logic', () => {
  it('contains 38 WCAG 2.0 A/AA criteria and no later criteria', () => {
    expect(requirements).toHaveLength(38);
    expect(requirements.some((r) => r.id === '1.4.10')).toBe(false);
    expect(requirements.every((r) => ['A', 'AA'].includes(r.level))).toBe(true);
  });
  it('maps only supplied known WCAG tags', () =>
    expect(mapTags(['wcag2a', 'wcag111', 'wcag412', 'wcag999'])).toEqual(['1.1.1', '4.1.2']));
  it('prioritizes observed impact deterministically', () =>
    expect(['critical', 'serious', 'moderate', 'minor', 'unknown'].map(priority)).toEqual([
      1, 2, 3, 4, 5,
    ]));
  it('hashes raw bytes and gives stable scoped IDs', () => {
    expect(hash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'));
    expect(stableId('ab', 'c')).not.toBe(stableId('a', 'bc'));
  });
  it('rejects hallucinated evidence and finding IDs and conformance fields', () => {
    const result = {
      findingId: 'f1',
      evidenceIds: ['e1'],
      explanation: 'An explanation grounded in supplied evidence.',
      remediation: 'A suggested fix requiring verification.',
      verification: 'Rerun the scanner and manually inspect.',
      reviewQuestions: [],
    };
    expect(validateExplanation(result, 'f1', ['e1'])).toEqual(result);
    expect(() => validateExplanation({ ...result, evidenceIds: ['fake'] }, 'f1', ['e1'])).toThrow();
    expect(() => validateExplanation({ ...result, findingId: 'fake' }, 'f1', ['e1'])).toThrow();
    expect(() =>
      validateExplanation({ ...result, conformance: 'Supports' }, 'f1', ['e1']),
    ).toThrow();
  });
  it('never converts a clean scan into Supports', () => {
    const a = {
      status: 'completed',
      pages: [{ id: 'p1' }],
      findings: [],
      tasks: [],
    } as unknown as AssessmentDetail;
    expect(matrix(a, requirements).every((r) => r.conclusion === null && !r.ready)).toBe(true);
  });
  it('blocks a positive decision with unresolved violations', () => {
    const a = {
      status: 'completed',
      pages: [{ id: 'p1' }],
      findings: [{ id: 'f1', mappings: [{ requirementId: '1.1.1' }], evidence: [{ id: 'e1' }] }],
      tasks: [
        {
          id: 't1',
          kind: 'criterion',
          requirementId: '1.1.1',
          status: 'resolved',
          decisions: [{ outcome: 'Supports' }],
        },
      ],
    } as unknown as AssessmentDetail;
    expect(matrix(a, requirements)[0]).toMatchObject({
      conclusion: null,
      ready: false,
      contradictory: true,
    });
  });
});

describe('evidence and living-report invariants', () => {
  it('canonicalizes JSON without losing timestamps or emitting invalid undefined fields', async () => {
    const { canonicalJson, evidenceHash } = await import('../packages/core/src/ids');
    expect(
      canonicalJson({ z: undefined, b: new Date('2026-01-01T00:00:00Z'), a: [undefined, 1] }),
    ).toBe('{"a":[null,1],"b":"2026-01-01T00:00:00.000Z"}');
    expect(evidenceHash({ b: 2, a: 1 })).toBe(evidenceHash({ a: 1, b: 2 }));
  });
  it('keeps unresolved OpenACR adherence absent and validates all 38 catalog criteria', async () => {
    const { openacrDocument } = await import('../packages/core/src/openacr');
    const snapshot = {
      assessment: { name: 'Isolated schema fixture', url: 'https://example.org/', scanRuns: [] },
      matrix: requirements.map((r) => ({ ...r, conclusion: null, evidenceIds: [] })),
      generatedAt: '2026-10-17T00:00:00Z',
      chapterApplicability: 'Unresolved',
    };
    const output = openacrDocument(
      snapshot,
      { name: 'Schema fixture author', email: 'fixture@example.test' },
      1,
    );
    expect(output.validation.valid).toBe(true);
    expect(JSON.stringify(output.document.chapters)).not.toContain('"adherence":');
  });
  it('requires the explicit bounded lab policy and preserves origin/path scope', () => {
    expect(() =>
      validateUrl('https://example.org/outside', false, {
        origin: 'https://example.org',
        pathPrefix: '/approved',
      }),
    ).toThrow();
    expect(() =>
      validateUrl('https://evil.test/approved', false, {
        origin: 'https://example.org',
        pathPrefix: '/approved',
      }),
    ).toThrow();
    expect(() =>
      validateUrl('http://127.0.0.1:4310/site/123', false, {
        origin: 'http://127.0.0.1:4310',
        pathPrefix: '/site/123',
        lab: false,
      }),
    ).toThrow();
  });
});


describe('audited W3C reference denominator',()=>{
 it('retains mixed narrative barriers and preserves historical dataset separately',async()=>{
  const {readFileSync}=await import('node:fs');
  const current=JSON.parse(readFileSync('data/reference-issues.json','utf8'));
  const old=JSON.parse(readFileSync('data/reference-issues-v1.json','utf8'));
  expect(old.issues).toHaveLength(126);expect(current.issues).toHaveLength(130);
  expect(current.issues.some((i:{id:string})=>i.id==='home:1.4.3:narrative')).toBe(true);
  for(const source of current.sources)expect(hash(readFileSync('data/references/'+source.page+'.html'))).toBe(source.sha256);
 });
});
