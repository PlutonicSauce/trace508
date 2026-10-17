import assert from 'node:assert/strict';
import { db } from '../../packages/core/src/db';
import {
  setup,
  digest,
  createSession,
  authenticate,
  issueAccountToken,
  acceptAccountToken,
  login,
} from '../../packages/core/src/auth';
import { randomBytes } from 'node:crypto';
const database = new URL(process.env.DATABASE_URL!);
assert(
  database.pathname.endsWith('_release_test'),
  'Destructive fixtures require an isolated _release_test database',
);
const password = 'Release fixture river lantern password';
let checks = 0;
const pass = (s: string) => {
  console.log('PASS ' + s);
  checks++;
};
async function reset() {
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.accountToken.deleteMany();
  await db.initialization.deleteMany();
  await db.projectEvent.deleteMany();
}
async function token(adoptLegacy = false) {
  const t = randomBytes(32).toString('hex');
  await db.initialization.create({
    data: {
      id: 'workspace',
      tokenHash: digest(t),
      expiresAt: new Date(Date.now() + 60000),
      organizationId: 'default',
      adoptLegacy,
    },
  });
  return t;
}
try {
  await reset();
  const details = {
    name: 'TEST FIXTURE bootstrap',
    email: 'bootstrap@fixture.test',
    password,
    organization: 'TEST FIXTURE organization',
  };
  await assert.rejects(() => setup({ ...details, token: 'x'.repeat(64) }));
  pass('clean DB rejects public first-visitor setup without provisioned token');
  const t = await token();
  const results = await Promise.allSettled([
    setup({ ...details, token: t }),
    setup({ ...details, email: 'race@fixture.test', token: t }),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(await db.user.count(), 1);
  pass('concurrent bootstrap admits exactly one administrator');
  await assert.rejects(() => setup({ ...details, token: t }));
  pass('initialized DB rejects reused initialization');
  const u = await db.user.findFirstOrThrow(),
    session = await createSession(u);
  const req = new Request('http://127.0.0.1:3020', {
    headers: { cookie: 'trace508_session=' + session },
  });
  assert.equal((await authenticate(req)).user.id, u.id);
  await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(() => authenticate(req));
  pass('session expiry enforced server-side');
  const invitation = await issueAccountToken(
    {
      email: 'invited@fixture.test',
      name: 'TEST FIXTURE invite',
      role: 'reviewer',
      organizationId: 'default',
      purpose: 'invitation',
    },
    'TEST FIXTURE operator',
    'default',
  );
  const stored = await db.accountToken.findUniqueOrThrow({
    where: { id: digest(invitation.token) },
  });
  assert.notEqual(stored.id, invitation.token);
  const member = await acceptAccountToken({ token: invitation.token, password });
  assert.equal(member.role, 'reviewer');
  await assert.rejects(() => acceptAccountToken({ token: invitation.token, password }));
  pass('invitation hashed, scoped and single use');
  const recovery = await issueAccountToken(
    {
      email: u.email,
      name: u.name,
      role: u.role,
      organizationId: u.organizationId,
      userId: u.id,
      purpose: 'recovery',
    },
    'TEST FIXTURE operator',
    'default',
  );
  assert.equal(await db.session.count({ where: { userId: u.id } }), 0);
  await acceptAccountToken({ token: recovery.token, password: password + ' updated' });
  await assert.rejects(() => login({ email: u.email, password }));
  assert.equal((await login({ email: u.email, password: password + ' updated' })).id, u.id);
  pass('recovery revokes sessions and changes password without replacing user or role');
  for (let i = 0; i < 5; i++)
    await assert.rejects(() => login({ email: u.email, password: 'wrong fixture credential' }));
  await assert.rejects(() => login({ email: u.email, password: password + ' updated' }), {
    code: 'RATE_LIMIT',
  });
  pass('persisted login throttle rejects sixth attempt');
  await db.loginLimit.deleteMany();
  await reset();
  const legacy = await db.assessment.create({
    data: {
      name: 'TEST FIXTURE legacy ownership marker',
      url: 'https://example.com/',
      variant: 'custom',
      status: 'failed',
    },
  });
  const oldOrg = await db.organization.findUniqueOrThrow({ where: { id: 'default' } });
  const lt = await token(false);
  await assert.rejects(() => setup({ ...details, token: lt }), { code: 'LEGACY_OWNERSHIP' });
  pass('legacy evidence requires trusted explicit adoption');
  await db.initialization.update({ where: { id: 'workspace' }, data: { adoptLegacy: true } });
  await setup({ ...details, token: lt });
  assert.equal(
    (await db.assessment.findUniqueOrThrow({ where: { id: legacy.id } })).projectId,
    'default',
  );
  assert.equal(
    (await db.organization.findUniqueOrThrow({ where: { id: 'default' } })).name,
    oldOrg.name,
  );
  pass('adoption preserves evidence ownership and organization name');
  await db.assessment.delete({ where: { id: legacy.id } });
  await db.user.deleteMany();
  await assert.rejects(() => setup({ ...details, token: lt }), { code: 'SETUP_COMPLETE' });
  pass('deleting accounts cannot reopen initialization');
  await reset();
  console.log(`${checks} database/auth security checks passed`);
} finally {
  await db.$disconnect();
}
