import { describe, it, expect, vi, afterEach } from 'vitest';
import { passwordHash, checkPassword, validatePassword } from '../packages/core/src/passwords';
import { providerExplanation } from '../packages/core/src/ai';
import { assertOrigin, validateUrl } from '../packages/core/src/security';
afterEach(() => vi.unstubAllEnvs());
describe('credential policy and hashing', () => {
  it('rejects short, repeated and known common secrets; accepts passphrases and Unicode', () => {
    for (const p of ['12345678901234', 'passwordpassword', 'aaaaaaaaaaaaaaaa'])
      expect(() => validatePassword(p)).toThrow();
    expect(validatePassword('River lamps orbit quiet fields')).toBeTruthy();
    expect(validatePassword('é'.repeat(14) + 'x')).toBeTruthy();
  });
  it('uses Argon2id with 64MiB/3 iterations and randomized salts', async () => {
    const p = 'A distinct secure fixture passphrase';
    const a = await passwordHash(p),
      b = await passwordHash(p);
    expect(a).toContain('$argon2id$v=19$');
    for (const parameter of ['m=65536', 't=3', 'p=1']) expect(a).toContain(parameter);
    expect(a).not.toBe(b);
    expect(await checkPassword(p, a)).toBe(true);
    expect(await checkPassword('Incorrect fixture passphrase', a)).toBe(false);
  });
  it('rejects cookie mutations without Origin and cross-site fetches', () => {
    for (const headers of [
      new Headers({ cookie: 'trace508_session=x' }),
      new Headers({ origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'cross-site' }),
    ])
      expect(() =>
        assertOrigin(new Request('http://127.0.0.1:3000/api/users', { headers })),
      ).toThrow();
  });
});
describe('AI provider contract fault injection (no inference requests)', () => {
  const result = {
    findingId: 'f',
    evidenceIds: ['e'],
    explanation: 'Evidence-grounded explanation.',
    remediation: 'Suggested correction requiring retest.',
    verification: 'Execute a new scan and human review.',
    reviewQuestions: [],
  };
  const fake = (status: number, body: unknown) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  it('defaults to disabled and makes no network request', async () => {
    vi.stubEnv('AI_PROVIDER', 'none');
    const transport = fake(200, {});
    await expect(providerExplanation({}, 'f', ['e'], transport)).rejects.toThrow('disabled');
    expect(transport).not.toHaveBeenCalled();
  });
  it('accepts only schema-valid local responses with supplied IDs', async () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    const transport = fake(200, { response: JSON.stringify(result) });
    expect((await providerExplanation({}, 'f', ['e'], transport)).parsed).toEqual(result);
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/generate');
    await expect(
      providerExplanation(
        {},
        'f',
        ['e'],
        fake(200, { response: JSON.stringify({ ...result, evidenceIds: ['invented'] }) }),
      ),
    ).rejects.toThrow('unsupported');
  });
  it.each([404, 429, 500])('fails closed on provider HTTP %s without retries', async (status) => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    const transport = fake(status, {});
    await expect(providerExplanation({}, 'f', ['e'], transport)).rejects.toThrow(`HTTP ${status}`);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed and oversized responses and transport outages', async () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    await expect(
      providerExplanation({}, 'f', ['e'], fake(200, { response: 'not JSON' })),
    ).rejects.toThrow();
    await expect(
      providerExplanation({}, 'f', ['e'], fake(200, { response: 'x'.repeat(65000) })),
    ).rejects.toThrow('limit');
    await expect(
      providerExplanation({}, 'f', ['e'], vi.fn().mockRejectedValue(new Error('offline'))),
    ).rejects.toThrow('unavailable');
  });
  it('never falls back to billed cloud inference and rejects alternate local endpoints', async () => {
    vi.stubEnv('AI_PROVIDER', 'gemini');
    vi.stubEnv('ALLOW_CLOUD_AI', 'false');
    vi.stubEnv('GEMINI_API_KEY', 'fixture-no-real-key');
    const transport = fake(200, {});
    await expect(providerExplanation({}, 'f', ['e'], transport)).rejects.toThrow('disabled');
    expect(transport).not.toHaveBeenCalled();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_ORIGIN', 'http://169.254.169.254');
    await expect(providerExplanation({}, 'f', ['e'], transport)).rejects.toThrow('origin');
  });
});
describe('URL parser adversarial cases', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'http://2130706433/',
    'http://0x7f000001/',
    'https://[::ffff:127.0.0.1]/',
    'https://example.org@127.0.0.1/',
  ])('rejects %s', (u) =>
    expect(() =>
      validateUrl(u, false, { origin: 'https://example.com', pathPrefix: '/' }),
    ).toThrow(),
  );
});
