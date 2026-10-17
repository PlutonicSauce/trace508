import { chromium, type Page as BrowserPage } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import axe from 'axe-core';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../../packages/core/src/db';
import { hash, stableId, evidenceHash } from '../../packages/core/src/ids';
import {
  mapTags,
  MAPPING_VERSION,
  priority,
  requirements,
} from '../../packages/core/src/requirements';
import {
  validateUrl,
  resolvePublicHost,
  isLabPolicy,
  type TargetPolicy,
} from '../../packages/core/src/security';
import { reconcileRetests } from '../../packages/core/src/remediation';
import { type JourneyStep } from '../../packages/core/src/journeys';
import { directoryBytes, assertStorageBudget } from '../../packages/core/src/quotas';
import { localPath } from '../../packages/core/src/storage';
const playwrightVersion = createRequire(import.meta.url)('playwright/package.json').version;
export const scannerVersion = `axe-core ${axe.version} / Playwright ${playwrightVersion}`;
export async function scanAssessment(
  id: string,
  options: { offline?: boolean; leaseValid?: () => boolean; navigationTimeoutMs?: number } = {},
) {
  const assessment = await db.assessment.findUniqueOrThrow({
    where: { id },
    include: { pages: true, target: true, journey: true },
  });
  if (assessment.status !== 'running') return;
  if (options.navigationTimeoutMs) {
    const project = await db.project.findUniqueOrThrow({ where: { id: assessment.projectId } });
    if (!project.isFixture)
      throw new Error('Fault injection requires an isolated fixture project.');
  }
  const config = assessment.configuration as {
    target?: TargetPolicy;
    journey?: { steps: JourneyStep[]; allowSubmission: boolean };
    scope?: string[];
  };
  const policy = config.target ?? assessment.target ?? undefined;
  const journey =
    config.journey ??
    (assessment.journey
      ? {
          steps: assessment.journey.steps as JourneyStep[],
          allowSubmission: assessment.journey.allowSubmission,
        }
      : undefined);
  const run = await db.scanRun.create({
    data: {
      assessmentId: id,
      scannerVersion,
      configuration: JSON.parse(
        JSON.stringify({
          scope: assessment.pages.map((p) => p.url),
          policy,
          journeyId: assessment.journeyId,
          steps: journey?.steps.map((s) => ({ ...s, value: s.value ? '[redacted]' : undefined })),
          tags: ['wcag2a', 'wcag2aa'],
          viewport: { width: 1440, height: 1000 },
          maxRuntimeMs: 120000,
          maxRequests: 400,
          navigationTimeoutMs: options.navigationTimeoutMs ?? 30000,
        }),
      ),
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    cancelled: ReturnType<typeof setInterval> | undefined;
  const rawPages: unknown[] = [];
  try {
    await assertStorageBudget(assessment.projectId);
    const initial = validateUrl(assessment.url, false, policy);
    const local = policy && isLabPolicy(policy);
    const addresses = local ? [] : await resolvePublicHost(initial.hostname);
    const ip = addresses.find((a) => a.family === 4)?.address;
    if (!local && !ip) throw new Error('No public IPv4 address available for pinned navigation.');
    browser = process.env.BROWSER_WS_ENDPOINT
      ? await chromium.connect(process.env.BROWSER_WS_ENDPOINT, { timeout: 20000 })
      : await chromium.launch({
          headless: true,
          args: [
            ...(ip ? [`--host-resolver-rules=MAP ${initial.hostname} ${ip}`] : []),
            '--disable-background-networking',
            '--disable-quic',
            '--no-proxy-server',
          ],
        });
    await db.scanRun.update({ where: { id: run.id }, data: { browserVersion: browser.version() } });
    let disconnected=false;browser.on('disconnected',()=>{disconnected=true;});
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
      offline: options.offline ?? false,
      acceptDownloads: false,
    });
    const stop = () => context.close().catch(() => {});
    const failBudget=async(message:string)=>db.$transaction(async tx=>{
      const changed=await tx.assessment.updateMany({where:{id,status:'running'},data:{status:'failed',error:message,progress:'Browser interrupted'}});
      if(changed.count){await tx.scanRun.updateMany({where:{id:run.id,status:'running'},data:{status:'failed',error:message,completedAt:new Date()}});await tx.journeyStepRun.updateMany({where:{assessmentId:id,status:'running'},data:{status:'failed',error:message,completedAt:new Date()}});await tx.auditEvent.create({data:{assessmentId:id,actor:'scan-worker',action:'browser-interrupted',detail:message}});}
    });
    timer = setTimeout(()=>{void failBudget('Hard scan runtime budget exhausted').catch(()=>{});void stop();},120000);
    cancelled = setInterval(async () => {
      try {
        const s = await db.assessment.findUnique({ where: { id }, select: { status: true } });
        if(disconnected)await failBudget('Chromium disconnected during assessment');
        if (s?.status !== 'running' || options.leaseValid?.() === false || disconnected) await stop();
      } catch {
        await stop();
      }
    }, 1000);
    let requests = 0;
    await context.route('**/*', async (route) => {
      try {
        const req = route.request();
        if (++requests > 400) throw new Error('Resource limit');
        validateUrl(req.url(), req.resourceType() !== 'document', policy);
        if (
          !['GET', 'HEAD'].includes(req.method()) &&
          !(
            req.method() === 'POST' &&
            req.resourceType() === 'document' &&
            journey?.allowSubmission &&
            policy?.allowSubmission
          )
        )
          throw new Error('Submission blocked by target and journey policy');
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket('**/*', (ws) => ws.close());
    const persist = async (
      record: { id: string; url: string },
      page: BrowserPage,
      index: number,
    ) => {
      validateUrl(page.url(), false, policy);
      await db.assessment.update({
        where: { id },
        data: { progress: `Scanning state ${index + 1}: WCAG 2.0 A/AA` },
      });
      if (requests > 400)
        throw new Error('Scan resource budget exceeded; no complete-scan claim can be made.');
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const title = await page.title();
      const dom = await page.content();
      if (Buffer.byteLength(dom) > 1000000)
        throw new Error('DOM evidence exceeded the one-megabyte state budget.');
      rawPages.push({ pageId: record.id, url: page.url(), result });
      const directory = localPath('evidence', id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const screenshot = path.join(directory, `${record.id}.png`);
      await page.screenshot({ path: screenshot, fullPage: false, timeout: 10_000 });
      await chmod(screenshot, 0o600);
      await writeFile(path.join(directory, `${record.id}.html`), dom, { mode: 0o600, flag: 'wx' });
      const screenshotBytes = await readFile(screenshot);
      if (screenshotBytes.length > 5000000)
        throw new Error('Screenshot exceeds five-megabyte budget.');
      const rawBytes = Buffer.byteLength(JSON.stringify(result));
      if (rawBytes > 10000000 || result.violations.reduce((n, v) => n + v.nodes.length, 0) > 2000)
        throw new Error('Scanner evidence exceeds state budget.');
      const screenshotSha256 = hash(screenshotBytes);
      const pageHash = evidenceHash(result);
      await writeFile(
        path.join(directory, `${record.id}.axe.json`),
        JSON.stringify(result, null, 2),
        { mode: 0o600, flag: 'wx' },
      );
      if ((await directoryBytes(directory)) > 64000000)
        throw new Error('Assessment artifact budget exceeds 64 MB. Partial evidence retained.');
      await db.$transaction(
        async (tx) => {
          if (options.leaseValid?.() === false) throw new Error('Worker lease lost');
          const active = await tx.assessment.updateMany({
            where: { id, status: 'running' },
            data: { progress: `Persisting scanner output: page ${index + 1}` },
          });
          if (!active.count) throw new Error('Assessment cancelled');
          await tx.page.update({ where: { id: record.id }, data: { title, url: page.url() } });
          await tx.evidence.create({
            data: {
              id: stableId(record.id, 'scan'),
              pageId: record.id,
              kind: 'scan',
              summary: `Full axe output; ${result.violations.length} violated rules, ${result.incomplete.length} rules needing review.`,
              payload: JSON.parse(JSON.stringify(result)),
              sha256: pageHash,
              hashScheme: 'canonical-json-sha256-v1',
              screenshot,
              screenshotSha256,
            },
          });
          await tx.evidence.create({
            data: {
              id: stableId(record.id, 'dom'),
              pageId: record.id,
              kind: 'dom-snapshot',
              summary:
                'Original DOM snapshot for this tested browser state. Treat content as untrusted and potentially sensitive.',
              payload: { html: dom, url: page.url() },
              sha256: evidenceHash({ html: dom, url: page.url() }),
              hashScheme: 'canonical-json-sha256-v1',
              screenshot,
              screenshotSha256,
            },
          });
          for (const violation of result.violations) {
            const fid = stableId(record.id, violation.id);
            await tx.finding.create({
              data: {
                id: fid,
                assessmentId: id,
                pageId: record.id,
                ruleId: violation.id,
                impact: violation.impact ?? 'unknown',
                description: violation.description,
                help: violation.help,
                helpUrl: violation.helpUrl,
                tags: violation.tags,
              },
            });
            for (let n = 0; n < violation.nodes.length; n++) {
              const node = violation.nodes[n];
              await tx.evidence.create({
                data: {
                  id: stableId(fid, String(n)),
                  pageId: record.id,
                  findingId: fid,
                  kind: 'axe-node',
                  selector: JSON.stringify(node.target),
                  html: node.html,
                  summary: node.failureSummary ?? violation.help,
                  payload: JSON.parse(JSON.stringify(node)),
                  sha256: evidenceHash(node),
                  hashScheme: 'canonical-json-sha256-v1',
                  screenshot,
                  screenshotSha256,
                },
              });
            }
            for (const requirementId of mapTags(violation.tags))
              await tx.findingRequirement.create({
                data: {
                  findingId: fid,
                  requirementId,
                  method: 'axe WCAG tag association; partial criterion coverage',
                  version: MAPPING_VERSION,
                },
              });
            await tx.remediation.create({
              data: {
                id: stableId(fid, 'remediation'),
                findingId: fid,
                priority: priority(violation.impact ?? 'unknown'),
                guidance: violation.nodes[0]?.failureSummary ?? violation.help,
                verification: `Resolve the documented failure conditions, rerun axe rule ${violation.id}, then manually verify the interaction and related criteria.`,
              },
            });
            await tx.remediationEvent.create({
              data: {
                remediationId: stableId(fid, 'remediation'),
                status: 'open',
                actor: 'scan-worker',
                notes: `Observed rule ${violation.id}; original finding ${fid}. No remediation claim yet.`,
              },
            });
            await tx.reviewTask.create({
              data: {
                id: stableId(fid, 'validate'),
                assessmentId: id,
                pageId: record.id,
                requirementId: mapTags(violation.tags)[0] ?? '4.1.2',
                findingId: fid,
                kind: 'finding',
                reason:
                  'Validate this scanner finding against the live element. Confirm or reject the observation with test steps. This decision does not approve criterion conformance.',
              },
            });
          }
          for (const r of requirements)
            await tx.reviewTask.create({
              data: {
                id: stableId(record.id, r.id),
                assessmentId: id,
                pageId: record.id,
                requirementId: r.id,
                kind: 'criterion',
                reason: `${r.reviewGuide} ${result.incomplete.some((v) => mapTags(v.tags).includes(r.id)) ? 'axe also reported inconclusive checks for this criterion.' : ''}`,
              },
            });
          await tx.auditEvent.create({
            data: {
              assessmentId: id,
              action: 'page-scanned',
              actor: 'scan-worker',
              detail: `${record.url}; ${result.violations.length} violated rules; raw SHA-256 ${pageHash}`,
            },
          });
        },
        { timeout: 30_000 },
      );
    };
    let stateIndex = 0;
    for (const record of assessment.pages) {
      validateUrl(record.url, false, policy);
      const state = await db.assessment.findUniqueOrThrow({ where: { id } });
      if (state.status !== 'running') throw new Error('Assessment cancelled');
      await db.assessment.update({ where: { id }, data: { progress: 'Navigating ' + record.url } });
      const page = await context.newPage();
      page.on('dialog', (d) => d.dismiss());
      page.on('popup', (p) => void p.close());
      const response = await page.goto(record.url, {
        waitUntil: 'networkidle',
        timeout: options.navigationTimeoutMs ?? 30000,
      });
      if (!response?.ok())
        throw new Error(`Page returned HTTP ${response?.status() ?? 'no response'}`);
      const buildLabel = response.headers()['x-trace508-build'];
      if (buildLabel) await db.assessment.update({ where: { id }, data: { buildLabel } });
      await persist(record, page, stateIndex++);
      if (journey) {
        for (let index = 0; index < journey.steps.length; index++) {
          const step = journey.steps[index],
            beforeUrl = page.url();
          const execution = await db.journeyStepRun.create({
            data: { assessmentId: id, index, name: step.name, action: step.action, beforeUrl },
          });
          try {
            await db.assessment.update({
              where: { id },
              data: { progress: `Journey step ${index + 1}/${journey.steps.length}: ${step.name}` },
            });
            if (step.action === 'goto') {
              validateUrl(step.url!, false, policy);
              const r = await page.goto(step.url!, { waitUntil: 'networkidle', timeout: 15000 });
              if (!r?.ok())
                throw new Error('Journey navigation did not return a successful response.');
            }
            if (step.action === 'fill')
              await page.locator(step.selector!).fill(step.value ?? '', { timeout: 10000 });
            if (step.action === 'click')
              await page.locator(step.selector!).click({ timeout: 10000 });
            if (step.action === 'press')
              await page.locator(step.selector!).press(step.value!, { timeout: 10000 });
            if (step.action === 'check')
              await page.locator(step.selector!).check({ timeout: 10000 });
            await page.waitForLoadState('networkidle', { timeout: 15000 });
            validateUrl(page.url(), false, policy);
            let pageId: string | undefined;
            if (step.scan) {
              pageId = stableId(id, 'step', String(index));
              const rec = await db.page.create({
                data: {
                  id: pageId,
                  assessmentId: id,
                  url: page.url(),
                  stateKey: `step:${index}:${step.name}`,
                },
              });
              await persist(rec, page, stateIndex++);
            }
            await db.journeyStepRun.update({
              where: { id: execution.id },
              data: { status: 'completed', afterUrl: page.url(), pageId, completedAt: new Date() },
            });
          } catch (e) {
            const error = e instanceof Error ? e.message : 'Journey step failed';
            await db.journeyStepRun.update({
              where: { id: execution.id },
              data: { status: 'failed', afterUrl: page.url(), error, completedAt: new Date() },
            });
            throw e;
          }
        }
      }
      await page.close();
    }
    await db.$transaction(async (tx) => {
      if (options.leaseValid?.() === false) throw new Error('Worker lease lost');
      const active = await tx.assessment.updateMany({
        where: { id, status: 'running' },
        data: {
          status: 'completed',
          progress: 'Scan complete. Human validation remains required.',
        },
      });
      if (!active.count) throw new Error('Assessment cancelled');
      await tx.scanRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          raw: JSON.parse(JSON.stringify(rawPages)),
        },
      });
      await tx.auditEvent.create({
        data: {
          assessmentId: id,
          action: 'scan-completed',
          actor: 'scan-worker',
          detail: `${stateIndex} real page/state scans using ${scannerVersion}. Conformance requires human review.`,
        },
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scanner failed',
      state = await db.assessment.findUnique({ where: { id } });
    if (state)
      await db.$transaction([
        db.assessment.update({
          where: { id },
          data: {
            status: state.status === 'cancelled' ? 'cancelled' : 'failed',
            error: message,
            progress: 'Scan stopped. Partial evidence is retained.',
          },
        }),
        db.scanRun.update({
          where: { id: run.id },
          data: {
            status: state.status === 'cancelled' ? 'cancelled' : 'failed',
            error: message,
            completedAt: new Date(),
            raw: JSON.parse(JSON.stringify(rawPages)),
          },
        }),
        db.auditEvent.create({
          data: { assessmentId: id, action: 'scan-stopped', actor: 'scan-worker', detail: message },
        }),
      ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (cancelled) clearInterval(cancelled);
    await Promise.race([browser?.close().catch(()=>{}),new Promise(r=>setTimeout(r,5000))]);
  }
  await reconcileRetests(id);
}
