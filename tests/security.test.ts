import { describe, it, expect, vi, afterEach } from 'vitest';
import { passwordHash, checkPassword, validatePassword } from '../packages/core/src/passwords';
import { providerExplanation } from '../packages/core/src/ai';
import { assertOrigin, validateUrl, isPublicIp } from '../packages/core/src/security';
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
    vi.stubEnv('AI_PROVIDER', 'groq');
    vi.stubEnv('ALLOW_CLOUD_AI', 'false');
    vi.stubEnv('GROQ_API_KEY', 'fixture-no-real-key');
    await expect(providerExplanation({}, 'f', ['e'], transport)).rejects.toThrow('disabled');
    expect(transport).not.toHaveBeenCalled();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_ORIGIN', 'http://169.254.169.254');
    await expect(providerExplanation({}, 'f', ['e'], transport)).rejects.toThrow('origin');
  });
  it('supports GroqCloud free tier with strict schema and cloud consent enforcement', async () => {
    vi.stubEnv('AI_PROVIDER', 'groq');
    vi.stubEnv('ALLOW_CLOUD_AI', 'true');
    vi.stubEnv('GROQ_API_KEY', 'gsk_fixture_test_key');
    const transport = fake(200, {
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
    const res = await providerExplanation({}, 'f', ['e'], transport);
    expect(res.parsed).toEqual(result);
    expect(res.provider).toBe('groq');
    expect(transport.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(transport.mock.calls[0][1]?.headers).toHaveProperty(
      'Authorization',
      'Bearer gsk_fixture_test_key',
    );
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

describe('Egress proxy and network isolation IP verification', () => {
  it('blocks cloud metadata, private, loopback, and reserved addresses', () => {
    const blocked = [
      '169.254.169.254', // AWS / GCP / Azure cloud metadata
      '169.254.1.1', // Link-local
      '127.0.0.1', // Loopback
      '10.0.0.1', // RFC 1918 Private class A
      '172.16.0.1', // RFC 1918 Private class B
      '192.168.1.1', // RFC 1918 Private class C
      '0.0.0.0', // Unspecified
      '224.0.0.1', // Multicast
      '::1', // IPv6 Loopback
      'fe80::1', // IPv6 Link-local
    ];
    for (const ip of blocked) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });

  it('permits public unicast routable addresses', () => {
    const publicIps = ['93.184.216.34', '8.8.8.8', '142.250.190.46'];
    for (const ip of publicIps) {
      expect(isPublicIp(ip)).toBe(true);
    }
  });
});

describe('Reviewer qualification vs cryptographic integrity modeling', () => {
  it('validates human reviewer qualification and testing methodology in decision schema', async () => {
    const { decisionSchema } = await import('../packages/core/src/review');
    const valid = decisionSchema.safeParse({
      reviewer: 'Qualified Evaluator',
      reviewerQualification: 'DHS Certified Trusted Tester v5.0',
      methodology: 'DHS Trusted Tester Process v5.0',
      outcome: 'Supports',
      notes: 'Verified accessible markup meets all requirements.',
      observation: 'Proper semantic structure and valid accessible name present.',
      evidenceIds: [],
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.reviewerQualification).toBe('DHS Certified Trusted Tester v5.0');
      expect(valid.data.methodology).toBe('DHS Trusted Tester Process v5.0');
    }
  });

  it('rejects oversized qualification or methodology strings', async () => {
    const { decisionSchema } = await import('../packages/core/src/review');
    const invalid = decisionSchema.safeParse({
      reviewer: 'Qualified Evaluator',
      reviewerQualification: 'x'.repeat(300),
      outcome: 'Supports',
      notes: 'Valid notes',
      observation: 'Valid observation',
      evidenceIds: [],
    });
    expect(invalid.success).toBe(false);
  });
});

describe('Deployment secrets generator permissions', () => {
  it('enforces 0700 on directory and 0600 on secret files without world-readability', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { execFileSync } = await import('node:child_process');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace508-sec-test-'));
    try {
      execFileSync('python3', [path.resolve('scripts/deployment-secrets.py')], {
        env: { ...process.env, SECRETS_DIR: tempDir },
      });

      const dirStat = await fs.stat(tempDir);
      // Directory must be 0700 (owner rwx only)
      expect(dirStat.mode & 0o777).toBe(0o700);

      for (const secretFile of ['db_password', 'database_url']) {
        const filePath = path.join(tempDir, secretFile);
        const fileStat = await fs.stat(filePath);
        // File must be 0600 (owner rw only)
        expect(fileStat.mode & 0o777).toBe(0o600);
        // Absolutely no group or world permissions
        expect(fileStat.mode & 0o077).toBe(0);
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
