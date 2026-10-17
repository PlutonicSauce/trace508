import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { AppError } from './errors';
export const roles = ['viewer', 'operator', 'reviewer', 'admin'] as const;
export type Role = (typeof roles)[number];
export const actor = (u: { id: string; name: string; email: string }) =>
  `${u.name} <${u.email}> [${u.id}]`;
export { passwordHash } from './passwords';
import { passwordHash, checkPassword } from './passwords';
const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const credentials = z.object({ email: emailSchema, password: z.string().min(1).max(400) });
export async function setup(value: unknown) {
  const d = credentials
    .extend({
      token: z.string().min(32).max(200),
      name: z.string().trim().min(2).max(100),
      organization: z.string().trim().min(2).max(100),
    })
    .parse(value);
  const issued = await db.initialization.findUnique({ where: { id: 'workspace' } });
  if (issued?.completedAt)
    throw new AppError(409, 'SETUP_COMPLETE', 'Initial setup has already been completed.');
  if (
    !issued?.tokenHash ||
    !issued.expiresAt ||
    issued.expiresAt < new Date() ||
    issued.tokenHash !== digest(d.token)
  )
    throw new AppError(
      403,
      'BOOTSTRAP_REQUIRED',
      'A valid operator-issued bootstrap token is required.',
    );
  const hashed = await passwordHash(d.password);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(50801)`;
    const init = await tx.initialization.findUnique({ where: { id: 'workspace' } });
    if (init?.completedAt || (await tx.user.count()))
      throw new AppError(409, 'SETUP_COMPLETE', 'Initial setup has already been completed.');
    if (
      !init?.tokenHash ||
      !init.expiresAt ||
      init.expiresAt < new Date() ||
      !timingSafeEqual(Buffer.from(init.tokenHash), Buffer.from(digest(d.token)))
    )
      throw new AppError(
        403,
        'BOOTSTRAP_REQUIRED',
        'A valid operator-issued bootstrap token is required.',
      );
    const legacy = await tx.assessment.count();
    if (legacy && !init.adoptLegacy)
      throw new AppError(
        409,
        'LEGACY_OWNERSHIP',
        'A trusted operator must explicitly authorize adoption of legacy evidence.',
      );
    const organizationId = init.organizationId ?? 'default';
    await tx.organization.upsert({
      where: { id: organizationId },
      create: { id: organizationId, name: d.organization },
      update: legacy ? {} : { name: d.organization },
    });
    await tx.project.upsert({
      where: { id: 'default' },
      create: { id: 'default', organizationId, name: 'Accessibility assurance' },
      update: {},
    });
    const u = await tx.user.create({
      data: { organizationId, email: d.email, name: d.name, passwordHash: hashed, role: 'admin' },
    });
    await tx.initialization.update({
      where: { id: 'workspace' },
      data: { completedAt: new Date(), tokenHash: null, expiresAt: null },
    });
    await tx.projectEvent.create({
      data: {
        projectId: 'default',
        actor: actor(u),
        action: 'trusted-initialization-completed',
        detail: `Operator-authorized initialization; legacy adoption=${init.adoptLegacy}. Existing evidence ownership unchanged.`,
      },
    });
    return u;
  });
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function login(value: unknown) {
  const d = credentials.parse(value),
    key = createHash('sha256').update(d.email).digest('hex');
  const limit = await db.loginLimit.findUnique({ where: { id: key } });
  if (limit && limit.resetAt > new Date() && limit.attempts >= 5)
    throw new AppError(429, 'RATE_LIMIT', 'Too many sign-in attempts. Try again in 15 minutes.');
  const u = await db.user.findUnique({ where: { email: d.email } });
  const valid = await checkPassword(
    d.password,
    u?.passwordHash ??
      '$argon2id$v=19$m=65536,p=1,t=3$2RJ+3djvx1JWhOXwb3+cKA$Vxadxzgbl/UDY5DME8hBjC1AVVtNLKhLrSSGv+0zkH8',
  );
  if (!u || u.disabled || !valid) {
    await db.loginLimit.upsert({
      where: { id: key },
      create: { id: key, attempts: 1, resetAt: new Date(Date.now() + 900000) },
      update:
        limit && limit.resetAt > new Date()
          ? { attempts: { increment: 1 } }
          : { attempts: 1, resetAt: new Date(Date.now() + 900000) },
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if([...d.password.normalize('NFC')].length<15)throw new AppError(403,'PASSWORD_UPGRADE_REQUIRED','Your password must be replaced through an administrator-issued recovery token before signing in.');
  await db.loginLimit.deleteMany({ where: { id: key } });
  if (!u.passwordHash.startsWith('$argon2id$') && [...d.password].length >= 15)
    await db.user.update({
      where: { id: u.id },
      data: { passwordHash: await passwordHash(d.password) },
    });
  return u;
}
export async function createSession(user: { id: string; organizationId: string }) {
  const project = await db.project.findFirstOrThrow({
    where: { organizationId: user.organizationId },
    orderBy: { id: 'asc' },
  });
  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      id: createHash('sha256').update(token).digest('hex'),
      userId: user.id,
      projectId: project.id,
      expiresAt: new Date(Date.now() + 8 * 3600000),
    },
  });
  return token;
}
export const sessionId = (request: Request) => {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('trace508_session='))
    ?.split('=')[1];
  return token ? createHash('sha256').update(token).digest('hex') : '';
};
export async function authenticate(request: Request) {
  const s = await db.session.findUnique({
    where: { id: sessionId(request) },
    include: { user: true, project: true },
  });
  if (
    !s ||
    s.expiresAt < new Date() ||
    s.user.disabled ||
    s.user.organizationId !== s.project.organizationId
  )
    throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to access this workspace.');
  return s;
}
export type Auth = Awaited<ReturnType<typeof authenticate>>;
export function requireRole(auth: Auth, allowed: Role[]) {
  if (!allowed.includes(auth.user.role as Role))
    throw new AppError(403, 'FORBIDDEN', 'Your role does not permit this action.');
}
export async function assertAssessment(auth: Auth, id: string) {
  const a = await db.assessment.findFirst({ where: { id, projectId: auth.projectId } });
  if (!a) throw new AppError(404, 'NOT_FOUND', 'Assessment not found in this project.');
  return a;
}
export const cookie = (token: string) =>
  `trace508_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${process.env.APP_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`;
export async function addUser(auth: Auth, input: unknown) {
  requireRole(auth, ['admin']);
  const d = z
    .object({ email: emailSchema, name: z.string().trim().min(2).max(100), role: z.enum(roles) })
    .parse(input);
  if (await db.user.findUnique({ where: { email: d.email } }))
    throw new AppError(409, 'ACCOUNT_EXISTS', 'An account with this address already exists.');
  return issueAccountToken(
    { ...d, organizationId: auth.user.organizationId, purpose: 'invitation' },
    actor(auth.user),
    auth.projectId,
  );
}
export async function issueAccountToken(
  data: {
    email: string;
    name: string;
    role: string;
    organizationId: string;
    purpose: string;
    userId?: string;
  },
  who: string,
  projectId: string,
) {
  const token = randomBytes(32).toString('base64url');
  await db.$transaction(async (tx) => {
    await tx.accountToken.updateMany({
      where: { email: data.email, organizationId: data.organizationId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.accountToken.create({
      data: { ...data, id: digest(token), expiresAt: new Date(Date.now() + 86400000) },
    });
    if (data.userId) await tx.session.deleteMany({ where: { userId: data.userId } });
    await tx.projectEvent.create({
      data: {
        projectId,
        actor: who,
        action: 'account-token-issued',
        detail: `${data.purpose} for ${data.email}; 24-hour single use; no email ownership verification asserted.`,
      },
    });
  });
  return { token, expiresInHours: 24, purpose: data.purpose };
}
export async function acceptAccountToken(value: unknown) {
  const d = z
    .object({ token: z.string().min(32).max(200), password: z.string().max(400) })
    .parse(value);
  const id = digest(d.token);
  const issued = await db.accountToken.findUnique({ where: { id } });
  if (!issued || issued.usedAt || issued.expiresAt < new Date())
    throw new AppError(403, 'INVALID_TOKEN', 'Invitation or recovery token is invalid or expired.');
  const hashed = await passwordHash(d.password);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AccountToken" WHERE id=${id} FOR UPDATE`;
    const t = await tx.accountToken.findUnique({ where: { id } });
    if (!t || t.usedAt || t.expiresAt < new Date())
      throw new AppError(
        403,
        'INVALID_TOKEN',
        'Invitation or recovery token is invalid or expired.',
      );
    const user = t.userId
      ? await tx.user.update({
          where: { id: t.userId, organizationId: t.organizationId, disabled: false },
          data: { passwordHash: hashed },
        })
      : await tx.user.create({
          data: {
            organizationId: t.organizationId,
            email: t.email,
            name: t.name,
            role: t.role,
            passwordHash: hashed,
          },
        });
    await tx.accountToken.update({ where: { id }, data: { usedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    const project = await tx.project.findFirstOrThrow({
      where: { organizationId: t.organizationId },
    });
    await tx.projectEvent.create({
      data: {
        projectId: project.id,
        actor: actor(user),
        action: 'account-token-consumed',
        detail: `${t.purpose} completed; prior sessions revoked.`,
      },
    });
    return user;
  });
}
