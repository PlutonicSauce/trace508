import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z, ZodError } from 'zod';
import { db } from '@core/db';
import { createAssessment, getAssessment, matrix, retryAssessment } from '@core/assessment';
import { assertOrigin, validatePolicy } from '@core/security';
import { saveDecision } from '@core/review';
import { explainFinding, aiConfiguration } from '@core/ai';
import { generateReport } from '@core/reports';
import { benchmark, saveBenchmarkDecision } from '@core/benchmark';
import { adapters } from '@core/adapters';
import { hash } from '@core/ids';
import { localPath } from '@core/storage';
import {
  authenticate,
  requireRole,
  assertAssessment,
  setup,
  login,
  createSession,
  cookie,
  sessionId,
  actor,
  addUser,
  acceptAccountToken,
  issueAccountToken,
  type Auth,
} from '@core/auth';
import { AppError } from '@core/errors';
import { initializeLab, changeLab } from '@core/lab';
import { createJourney } from '@core/journeys';
import { requestRetest, updateRemediation, verifyRemediation } from '@core/remediation';
import { createEvidencePackage, deleteAssessment } from '@core/provenance';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function scope(auth: Auth, p: string[], url: string) {
  if (p[0] === 'assessments' && p[1]) await assertAssessment(auth, p[1]);
  if (p[0] === 'compare') {
    const u = new URL(url);
    await assertAssessment(auth, u.searchParams.get('before') ?? '');
    await assertAssessment(auth, u.searchParams.get('after') ?? '');
  }
  let assessmentId: string | undefined;
  if (p[0] === 'evidence' && p[1])
    assessmentId = (
      await db.evidence.findUniqueOrThrow({ where: { id: p[1] }, include: { page: true } })
    ).page.assessmentId;
  if (p[0] === 'reports' && p[1])
    assessmentId = (await db.report.findUniqueOrThrow({ where: { id: p[1] } })).assessmentId;
  if (p[0] === 'packages' && p[1])
    assessmentId = (await db.evidencePackage.findUniqueOrThrow({ where: { id: p[1] } }))
      .assessmentId;
  if (p[0] === 'reviews' && p[1])
    assessmentId = (await db.reviewTask.findUniqueOrThrow({ where: { id: p[1] } })).assessmentId;
  if (p[0] === 'findings' && p[1])
    assessmentId = (await db.finding.findUniqueOrThrow({ where: { id: p[1] } })).assessmentId;
  if (p[0] === 'remediation' && p[1])
    assessmentId = (
      await db.remediation.findUniqueOrThrow({ where: { id: p[1] }, include: { finding: true } })
    ).finding.assessmentId;
  if (assessmentId) await assertAssessment(auth, assessmentId);
}
async function handle(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const { path: p } = await context.params,
      method = request.method;
    let body: any = {};
    if (['POST', 'PATCH', 'DELETE'].includes(method)) {
      assertOrigin(request);
      if (Number(request.headers.get('content-length') ?? 0) > 40000)
        throw new AppError(413, 'TOO_LARGE', 'Request too large');
      const reader = request.body?.getReader();
      let text = '',
        size = 0;
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 40000) {
            await reader.cancel();
            throw new AppError(413, 'TOO_LARGE', 'Request too large');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      }
      if (text.length > 40000) throw new AppError(413, 'TOO_LARGE', 'Request too large');
      body = text ? JSON.parse(text) : {};
    }
    if (method === 'GET' && p[0] === 'health')
      return json({
        database: !!(await db.$queryRaw`SELECT 1`),
        service: 'trace508',
        authentication: 'required',
      });
    if (p[0] === 'auth') {
      if (method === 'GET' && p[1] === 'status') {
        const init = await db.initialization.findUnique({ where: { id: 'workspace' } });
        const setupRequired = !init?.completedAt && (await db.user.count()) === 0;
        try {
          const s = await authenticate(request);
          return json({
            setupRequired,
            user: { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role },
            project: s.project,
          });
        } catch {
          return json({ setupRequired, user: null });
        }
      }
      if (method === 'POST' && ['login', 'setup', 'accept'].includes(p[1])) {
        const u =
            p[1] === 'setup'
              ? await setup(body)
              : p[1] === 'accept'
                ? await acceptAccountToken(body)
                : await login(body),
          token = await createSession(u);
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookie(token),
            'Cache-Control': 'no-store',
          },
        });
      }
    }
    const auth = await authenticate(request),
      who = actor(auth.user);
    await scope(auth, p, request.url);
    if (method === 'POST' && p[0] === 'auth' && p[1] === 'logout') {
      await db.session.deleteMany({ where: { id: sessionId(request) } });
      return new Response('{}', {
        headers: {
          'Set-Cookie': cookie('').replace('Max-Age=28800', 'Max-Age=0'),
          'Content-Type': 'application/json',
        },
      });
    }
    if (method === 'GET') {
      if (p[0] === 'workspace')
        return json({
          user: {
            id: auth.user.id,
            name: auth.user.name,
            email: auth.user.email,
            role: auth.user.role,
          },
          project: auth.project,
          projects: await db.project.findMany({
            where: { organizationId: auth.user.organizationId },
            orderBy: { name: 'asc' },
          }),
          targets: await db.target.findMany({ where: { projectId: auth.projectId } }),
          journeys: await db.journey.findMany({
            where: { projectId: auth.projectId },
            orderBy: { createdAt: 'desc' },
          }),
          labEnabled: process.env.ENABLE_LAB === 'true',
          gemini: aiConfiguration().configured,
          ai: aiConfiguration(),
          adapters: await Promise.all(adapters.map((a) => a.status())),
          labSites: await db.labSite.findMany({
            where: { projectId: auth.projectId },
            include: { revisions: { orderBy: { version: 'desc' }, take: 10 } },
          }),
          users:
            auth.user.role === 'admin'
              ? await db.user.findMany({
                  where: { organizationId: auth.user.organizationId },
                  select: { id: true, name: true, email: true, role: true, disabled: true },
                })
              : [],
          events: await db.projectEvent.findMany({
            where: { projectId: auth.projectId },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
        });
      if (p[0] === 'assessments' && !p[1])
        return json(
          await db.assessment.findMany({
            where: { projectId: auth.projectId },
            include: { _count: { select: { findings: true, pages: true, tasks: true } } },
            orderBy: { createdAt: 'desc' },
          }),
        );
      if (p[0] === 'assessments' && p[1]) {
        const a = await getAssessment(p[1]);
        return json({
          ...a,
          matrix: matrix(a!, await db.requirement.findMany({ orderBy: { id: 'asc' } })),
        });
      }
      if (p[0] === 'requirements')
        return json(await db.requirement.findMany({ orderBy: { id: 'asc' } }));
      if (p[0] === 'compare') {
        const u = new URL(request.url),
          b = (await getAssessment(u.searchParams.get('before')!))!,
          a = (await getAssessment(u.searchParams.get('after')!))!;
        if (b.variant !== 'before' || a.variant !== 'after')
          throw new AppError(400, 'INVALID_PAIR', 'Select a Before and an After assessment.');
        return json(benchmark(b, a));
      }
      if (p[0] === 'evidence' && p[1]) {
        const e = await db.evidence.findUniqueOrThrow({ where: { id: p[1] } });
        if (p[2] === 'screenshot' && e.screenshot) {
          if (!e.screenshot.startsWith(localPath('evidence') + '/'))
            throw new Error('Invalid artifact path');
          const bytes = await readFile(e.screenshot);
          if (e.screenshotSha256 && hash(bytes) !== e.screenshotSha256)
            throw new AppError(409, 'INTEGRITY_FAILURE', 'Screenshot hash mismatch');
          return new Response(bytes, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        return json({ ...e, screenshot: e.screenshot ? true : null });
      }
      if (p[0] === 'packages' && p[1]) {
        const e = await db.evidencePackage.findUniqueOrThrow({ where: { id: p[1] } });
        if (p[2] === 'digest')
          return new Response(e.sha256 + '  ' + e.id + '.zip\n', {
            headers: {
              'Content-Type': 'text/plain',
              'Content-Disposition': `attachment; filename="${e.id}.sha256"`,
              'Cache-Control': 'private, no-store',
            },
          });
        if (!e.path.startsWith(localPath('packages') + '/'))
          throw new Error('Invalid package path');
        const bytes = await readFile(e.path);
        if (hash(bytes) !== e.sha256)
          throw new AppError(409, 'INTEGRITY_FAILURE', 'Package hash mismatch');
        return new Response(bytes, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${e.id}.zip"`,
            'X-Content-SHA256': e.sha256,
            'Cache-Control': 'private, no-store',
          },
        });
      }
      if (p[0] === 'reports' && p[1]) {
        const r = await db.report.findUniqueOrThrow({ where: { id: p[1] } });
        if (p[2] === 'manifest')
          return new Response(JSON.stringify(r.snapshot, null, 2), {
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${r.id}-manifest.json"`,
              'Cache-Control': 'private, no-store',
            },
          });
        if (p[2] === 'openacr') {
          if (!r.openacr)
            throw new AppError(
              409,
              'NO_OPENACR',
              'This older report has no schema-validated OpenACR export. Generate a new version.',
            );
          return new Response(JSON.stringify(r.openacr, null, 2), {
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${r.id}.openacr.json"`,
              'Cache-Control': 'private, no-store',
            },
          });
        }
        if (!r.path.startsWith(localPath('reports') + '/')) throw new Error('Invalid report path');
        const bytes = await readFile(r.path);
        if (hash(bytes) !== r.sha256)
          throw new AppError(409, 'INTEGRITY_FAILURE', 'Report hash mismatch');
        return new Response(bytes, {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="Trace508-ACR-v${r.version}-${r.id}.docx"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }
    }
    if (method === 'POST' || method === 'PATCH') {
      if (p[0] === 'projects' && p[1] === 'switch') {
        const d = z.object({ projectId: z.string() }).parse(body);
        const proj = await db.project.findFirst({
          where: { id: d.projectId, organizationId: auth.user.organizationId },
        });
        if (!proj) throw new AppError(404, 'NOT_FOUND', 'Project not found');
        await db.session.update({ where: { id: auth.id }, data: { projectId: proj.id } });
        return json({ ok: true });
      }
      if (p[0] === 'projects' && !p[1]) {
        requireRole(auth, ['admin']);
        const d = z
          .object({
            name: z.string().trim().min(3).max(100),
            isFixture: z.boolean().default(false),
          })
          .parse(body);
        return json(
          await db.project.create({
            data: {
              ...d,
              organizationId: auth.user.organizationId,
              targets: {
                create: {
                  name: 'W3C BAD',
                  origin: 'https://www.w3.org',
                  pathPrefix: '/WAI/demos/bad',
                },
              },
            },
          }),
          201,
        );
      }
      if (p[0] === 'settings') {
        requireRole(auth, ['admin']);
        const d = z
          .object({
            name: z.string().trim().min(3).max(100),
            aiConsent: z.boolean(),
            retentionDays: z.number().int().min(1).max(3650),
            storageQuotaMb: z.number().int().min(64).max(10240).optional(),
          })
          .parse(body);
        await db.projectEvent.create({
          data: {
            projectId: auth.projectId,
            actor: who,
            action: 'project-settings-updated',
            detail: `Retention ${d.retentionDays} days; external AI consent ${d.aiConsent}`,
          },
        });
        return json(await db.project.update({ where: { id: auth.projectId }, data: d }));
      }
      if (p[0] === 'users' && p[1] && p[2] === 'recovery') {
        requireRole(auth, ['admin']);
        const u = await db.user.findFirstOrThrow({
          where: { id: p[1], organizationId: auth.user.organizationId, disabled: false },
        });
        return json(
          await issueAccountToken(
            {
              email: u.email,
              name: u.name,
              role: u.role,
              organizationId: u.organizationId,
              userId: u.id,
              purpose: 'administrator-recovery',
            },
            who,
            auth.projectId,
          ),
        );
      }
      if (p[0] === 'users' && p[1]) {
        requireRole(auth, ['admin']);
        const d = z.object({ disabled: z.boolean() }).parse(body);
        if (p[1] === auth.user.id)
          throw new AppError(
            409,
            'SELF_DISABLE',
            'You cannot disable your own administrator account.',
          );
        const member = await db.user.findFirstOrThrow({
          where: { id: p[1], organizationId: auth.user.organizationId },
        });
        await db.user.update({ where: { id: member.id }, data: { disabled: d.disabled } });
        if (d.disabled) await db.session.deleteMany({ where: { userId: member.id } });
        await db.projectEvent.create({
          data: {
            projectId: auth.projectId,
            actor: who,
            action: 'member-access-updated',
            detail: `Member ${member.id} disabled=${d.disabled}; disabled sessions revoked.`,
          },
        });
        return json({ ok: true });
      }
      if (p[0] === 'users') {
        return json(await addUser(auth, body), 201);
      }
      if (p[0] === 'targets') {
        requireRole(auth, ['admin']);
        const d = z
          .object({
            name: z.string().trim().min(3).max(100),
            origin: z.string().url(),
            pathPrefix: z.string().startsWith('/').max(300),
            allowSubmission: z.boolean().default(false),
          })
          .parse(body);
        await validatePolicy(d);
        const t = await db.target.create({ data: { ...d, projectId: auth.projectId } });
        await db.projectEvent.create({
          data: {
            projectId: auth.projectId,
            actor: who,
            action: 'target-permitted',
            detail: `${t.origin}${t.pathPrefix}; form submission ${t.allowSubmission}`,
          },
        });
        return json(t, 201);
      }
      if (p[0] === 'lab') {
        requireRole(auth, ['admin']);
        return json(
          p[1]
            ? await changeLab(auth.projectId, p[1], body, who)
            : await initializeLab(auth.projectId, who),
        );
      }
      if (p[0] === 'journeys') {
        requireRole(auth, ['operator', 'reviewer', 'admin']);
        return json(await createJourney(auth.projectId, body), 201);
      }
      if (p[0] === 'assessments' && !p[1]) {
        requireRole(auth, ['operator', 'reviewer', 'admin']);
        return json(
          await createAssessment(
            body,
            auth.projectId,
            who,
            undefined,
            false,
            request.headers.has('idempotency-key')
              ? z
                  .string()
                  .min(16)
                  .max(100)
                  .regex(/^[a-zA-Z0-9-]+$/)
                  .parse(request.headers.get('idempotency-key'))
              : undefined,
          ),
          201,
        );
      }
      if (p[0] === 'assessments' && p[2] === 'retry') {
        requireRole(auth, ['operator', 'reviewer', 'admin']);
        return json(await retryAssessment(p[1], auth.projectId, who), 201);
      }
      if (p[0] === 'assessments' && p[2] === 'packages') {
        requireRole(auth, ['reviewer', 'admin']);
        return json(await createEvidencePackage(p[1], who), 201);
      }
      if (p[0] === 'assessments' && p[2] === 'cancel') {
        requireRole(auth, ['operator', 'reviewer', 'admin']);
        const updated = await db.assessment.updateMany({
          where: { id: p[1], status: { in: ['queued', 'running', 'preparing'] } },
          data: { status: 'cancelled', progress: 'Cancellation requested' },
        });
        if (!updated.count)
          throw new AppError(409, 'NOT_ACTIVE', 'Only active scans can be cancelled.');
        await db.auditEvent.create({
          data: {
            assessmentId: p[1],
            actor: who,
            action: 'scan-cancelled',
            detail: 'Authenticated user requested cancellation.',
          },
        });
        return json({ status: 'cancelled' });
      }
      if (p[0] === 'benchmark-decisions') {
        requireRole(auth, ['reviewer', 'admin']);
        await assertAssessment(auth, body.assessmentId);
        return json(await saveBenchmarkDecision({ ...body, reviewer: who }), 201);
      }
      if (p[0] === 'reviews' && p[1]) {
        requireRole(auth, ['reviewer', 'admin']);
        return json(await saveDecision(p[1], { ...body, reviewer: who }));
      }
      if (p[0] === 'findings' && p[2] === 'explain') {
        requireRole(auth, ['operator', 'reviewer', 'admin']);
        if (aiConfiguration().external && !auth.project.aiConsent)
          throw new AppError(
            403,
            'AI_CONSENT_REQUIRED',
            'An administrator must explicitly permit sending minimized evidence to the external AI service.',
          );
        return json(await explainFinding(p[1]));
      }
      if (p[0] === 'remediation' && p[1]) {
        if (p[2] === 'verify') {
          requireRole(auth, ['reviewer', 'admin']);
          return json(await verifyRemediation(p[1], body, who));
        }
        requireRole(auth, ['operator', 'reviewer', 'admin']);
        return json(
          p[2] === 'retest'
            ? await requestRetest(p[1], who)
            : await updateRemediation(p[1], body, who),
        );
      }
      if (p[0] === 'reports' && !p[1]) {
        requireRole(auth, ['reviewer', 'admin']);
        const d = z.object({ assessmentId: z.string().uuid() }).parse(body);
        await assertAssessment(auth, d.assessmentId);
        return json(
          await generateReport(d.assessmentId, {
            name: auth.user.name,
            email: auth.user.email,
            actor: who,
          }),
          201,
        );
      }
      if (p[0] === 'reports' && p[2] === 'approve') {
        requireRole(auth, ['reviewer', 'admin']);
        throw new AppError(
          409,
          'DRAFT_ONLY',
          'Final approval requires completed criterion decisions, chapter applicability and organizational ratification. Draft export remains available.',
        );
      }
    }
    if (method === 'DELETE' && p[0] === 'assessments' && p[1]) {
      requireRole(auth, ['admin']);
      if (body.confirm !== p[1])
        throw new AppError(
          400,
          'CONFIRM_REQUIRED',
          'Deletion requires the assessment ID in the confirm field.',
        );
      return json(await deleteAssessment(p[1], auth.projectId, who));
    }
    throw new AppError(404, 'NOT_FOUND', 'API endpoint not found');
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof SyntaxError)
      return json({ error: 'Request body must be valid JSON.', code: 'INVALID_JSON' }, 400);
    if (e instanceof ZodError)
      return json(
        {
          error: 'Validation failed',
          code: 'VALIDATION',
          details: e.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
        400,
      );
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025')
      return json({ error: 'Requested record was not found', code: 'NOT_FOUND' }, 404);
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002')
      return json({ error: 'This record already exists.', code: 'CONFLICT' }, 409);
    const message = e instanceof Error ? e.message : 'Unexpected failure';
    console.error('Trace508 API failure', {
      requestId,
      type: e instanceof Error ? e.name : 'unknown',
      code: e && typeof e === 'object' && 'code' in e ? e.code : undefined,
    });
    const safe =
      message.length < 400 &&
      !message.includes('\n') &&
      /permitted|approved|configured|Gemini|Evidence|decision|Outcome|Criterion|Complete|requires|Queue|Destination|Assessment not found|AI returned|completed scan|Invalid model|Scan scope|Journeys|Journey/.test(
        message,
      );
    return json(
      {
        error: safe
          ? message
          : 'The operation failed. Consult the server log using the request time.',
        code: safe ? 'REQUEST_FAILED' : 'INTERNAL_ERROR',
        requestId,
      },
      safe ? 400 : 500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
