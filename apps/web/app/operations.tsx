'use client';
import { useState, type FormEvent } from 'react';
import { Activity, ArrowUpRight, Plus, Save, ShieldCheck } from 'lucide-react';
export type WorkspaceData = {
  user: { id: string; name: string; email: string; role: string };
  project: {
    id: string;
    name: string;
    isFixture: boolean;
    aiConsent: boolean;
    retentionDays: number;
    storageQuotaMb: number;
  };
  projects: { id: string; name: string; isFixture: boolean }[];
  targets: {
    id: string;
    name: string;
    origin: string;
    pathPrefix: string;
    lab: boolean;
    allowSubmission: boolean;
    enabled: boolean;
  }[];
  journeys: {
    id: string;
    name: string;
    targetId: string;
    steps: unknown[];
    allowSubmission: boolean;
  }[];
  labEnabled: boolean;
  gemini: boolean;
  labSites: {
    id: string;
    name: string;
    revision: number;
    revisions: {
      id: string;
      version: number;
      config: LabConfig;
      notes: string;
      actor: string;
      createdAt: string;
    }[];
  }[];
  users: { id: string; name: string; email: string; role: string; disabled: boolean }[];
  events: { id: string; actor: string; action: string; detail: string; createdAt: string }[];
};
type LabConfig = { imageAlt: boolean; formLabels: boolean; contrast: boolean };
export async function opsApi<T = any>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(
    '/api/' + url,
    body === undefined
      ? { cache: 'no-store' }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const d = await r.json();
  if (r.status === 401) window.dispatchEvent(new Event('trace508-session-expired'));
  if (!r.ok)
    throw new Error(
      d.error +
        (d.details
          ? ' · ' +
            d.details
              .map((x: { field: string; message: string }) => x.field + ': ' + x.message)
              .join(', ')
          : ''),
    );
  return d;
}
export function Operations({
  view,
  data,
  onRefresh,
  onAssessment,
}: {
  view: 'settings' | 'lab' | 'journeys';
  data: WorkspaceData;
  onRefresh: () => Promise<void>;
  onAssessment: (id: string) => void;
}) {
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [invitationToken, setInvitationToken] = useState('');
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setNotice(message);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="alert neutral">
        <ShieldCheck size={18} />
        <span>
          Signed in as {data.user.name} · {data.user.role}. Decisions use the authenticated account.{' '}
          {data.project.isFixture ? 'This project is an isolated test fixture environment.' : ''}
        </span>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {view === 'settings' && (
        <>
          <div className="assurance-grid">
            <section className="panel ops-form">
              <h2>Project settings</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(
                    () =>
                      opsApi('settings', {
                        name: f.get('name'),
                        retentionDays: Number(f.get('retentionDays')),
                        storageQuotaMb: Number(f.get('storageQuotaMb')),
                        aiConsent: f.has('aiConsent'),
                      }),
                    'Project policy saved.',
                  );
                }}
              >
                <label htmlFor="project-name">Project name</label>
                <input
                  id="project-name"
                  name="name"
                  defaultValue={data.project.name}
                  minLength={3}
                  required
                />
                <label htmlFor="retention-days">Retention period in days</label>
                <input
                  id="retention-days"
                  name="retentionDays"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={data.project.retentionDays}
                />
                <label htmlFor="storage-quota">Project artifact quota (MB)</label>
                <input
                  id="storage-quota"
                  name="storageQuotaMb"
                  type="number"
                  min={64}
                  max={10240}
                  defaultValue={data.project.storageQuotaMb}
                />
                <label>
                  <input type="checkbox" name="aiConsent" defaultChecked={data.project.aiConsent} />{' '}
                  Permit sending minimized evidence to the configured cloud AI provider
                </label>
                <p className="field-help">
                  Off by default. HTML is excluded from the AI payload. Evidence packages may
                  contain sensitive page content; only project members can access them. Retention
                  dates are enforced by the explicit administrator purge command.
                </p>
                <button className="button primary" disabled={busy || data.user.role !== 'admin'}>
                  <Save size={16} />
                  Save policy
                </button>
              </form>
            </section>
            <section className="panel ops-form">
              <h2>Permit a website</h2>
              <p className="field-help">
                Register a hostname and path you are authorized to assess. DNS, every document
                redirect, and resource requests remain constrained. Internal networks are blocked.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(
                    () =>
                      opsApi('targets', {
                        name: f.get('name'),
                        origin: f.get('origin'),
                        pathPrefix: f.get('pathPrefix'),
                        allowSubmission: f.has('allowSubmission'),
                      }),
                    'Target permitted. It can now be selected in New assessment.',
                  );
                }}
              >
                <label htmlFor="target-name">Target name</label>
                <input id="target-name" name="name" required minLength={3} />
                <label htmlFor="target-origin">HTTPS origin</label>
                <input
                  id="target-origin"
                  name="origin"
                  type="url"
                  placeholder="https://example.org"
                  required
                />
                <label htmlFor="target-prefix">Permitted path prefix</label>
                <input id="target-prefix" name="pathPrefix" defaultValue="/" required />
                <label>
                  <input type="checkbox" name="allowSubmission" /> Allow explicitly configured form
                  submission
                </label>
                <p className="field-help">
                  Only enable submission for websites you control or have explicit testing
                  permission for. Each journey must also opt in. Scan content cannot authorize
                  network access.
                </p>
                <button className="button primary" disabled={busy || data.user.role !== 'admin'}>
                  Register permitted target
                </button>
              </form>
            </section>
            <section className="panel ops-form">
              <h2>Create a project</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(
                    () =>
                      opsApi('projects', { name: f.get('name'), isFixture: f.has('isFixture') }),
                    'Project created. Select it in the top bar.',
                  );
                }}
              >
                <label htmlFor="new-project-name">New project name</label>
                <input id="new-project-name" name="name" minLength={3} required />
                <label>
                  <input type="checkbox" name="isFixture" /> Isolated test fixture project
                </label>
                <button className="button primary" disabled={busy || data.user.role !== 'admin'}>
                  Create project
                </button>
              </form>
              <h3 style={{ marginTop: 24 }}>Permitted targets</h3>
              {data.targets.map((t) => (
                <p className="field-help" key={t.id}>
                  {t.name}: {t.origin}
                  {t.pathPrefix} {t.lab ? '(controlled lab exception)' : ''}
                </p>
              ))}
            </section>
            <section className="panel ops-form">
              <h2>Add an organization member</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(async () => {
                    const result = await opsApi('users', Object.fromEntries(f));
                    setInvitationToken(result.token);
                  }, 'Single-use invitation issued. Transfer its token through your trusted channel; this does not verify email ownership.');
                }}
              >
                <label htmlFor="member-name">Member name</label>
                <input id="member-name" name="name" required minLength={2} />
                <label htmlFor="member-email">Member email</label>
                <input id="member-email" name="email" type="email" required autoComplete="off" />
                <label htmlFor="member-role">Role</label>
                <select id="member-role" name="role">
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="admin">Administrator</option>
                </select>
                <button className="button primary" disabled={busy || data.user.role !== 'admin'}>
                  Issue invitation
                </button>
              </form>
              <p className="field-help">
                Roles apply within the organization. Operators scan and propose changes; reviewers
                also approve observations and generate reports; administrators manage policies,
                accounts and deletion.
              </p>
              {invitationToken && (
                <div role="status">
                  <p>
                    Single-use invitation/recovery token, valid 24 hours. Copy now; the server
                    stores only its hash.
                  </p>
                  <code style={{ overflowWrap: 'anywhere' }}>{invitationToken}</code>
                </div>
              )}
              <h3 style={{ marginTop: 24 }}>Organization members</h3>
              {data.users.map((u) => (
                <div key={u.id} className="button-row">
                  <p className="field-help">
                    {u.name} · {u.role} · {u.email}
                    {u.disabled ? ' · disabled' : ''}
                  </p>
                  <button
                    className="text-button"
                    disabled={busy || u.id === data.user.id}
                    onClick={() =>
                      run(
                        () => opsApi('users/' + u.id, { disabled: !u.disabled }, 'PATCH'),
                        'Member access updated; disabled sessions were revoked.',
                      )
                    }
                  >
                    {u.disabled ? 'Enable access' : 'Disable access'}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || u.disabled}
                    onClick={() =>
                      run(async () => {
                        const r = await opsApi('users/' + u.id + '/recovery', {});
                        setInvitationToken(r.token);
                      }, 'Recovery token issued. Prior sessions revoked.')
                    }
                  >
                    Issue recovery token
                  </button>
                </div>
              ))}
            </section>
          </div>
          <section className="panel">
            <div className="panel-header">
              <h2>Project audit log</h2>
            </div>
            <div className="timeline">
              {data.events.map((e) => (
                <div className="timeline-item" key={e.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{e.action}</strong>
                    <p>{e.detail}</p>
                    <small>
                      {e.actor} · {new Date(e.createdAt).toLocaleString()}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {view === 'lab' && (
        <>
          <div className="fixture-banner">
            CONTROLLED TEST LAB. These are deliberately changeable test websites. Findings come from
            real browser scans, and never populate a live external assessment.
          </div>
          <section className="panel ops-form">
            <h2>Repeat the complete remediation loop</h2>
            <p className="field-help">
              Initialize two separate websites, assess a broken build, change its actual HTML
              configuration here, then request an independent retest from Remediation backlog. Human
              verification and criterion conformance stay separate.
            </p>
            <button
              className="button primary"
              disabled={busy || !data.labEnabled || data.user.role !== 'admin'}
              onClick={() =>
                run(
                  () => opsApi('lab', {}),
                  'Controlled fixture sites initialized. Ensure npm run lab is running.',
                )
              }
            >
              <Plus size={16} />
              Initialize controlled websites
            </button>
            {!data.labEnabled && (
              <p className="error-text">
                Set ENABLE_LAB=true on the server and worker to enable the bounded loopback
                exception.
              </p>
            )}
          </section>
          <div className="assurance-grid">
            {data.labSites.map((site) => (
              <LabEditor
                key={site.id + site.revision}
                site={site}
                data={data}
                busy={busy}
                save={(config, notes) =>
                  run(
                    () => opsApi('lab/' + site.id, { config, notes }),
                    'Saved a new real fixture build revision. Existing scan evidence is unchanged.',
                  )
                }
                scan={(url) =>
                  run(async () => {
                    const target = data.targets.find((t) => t.pathPrefix === `/site/${site.id}`)!;
                    const a = await opsApi('assessments', {
                      name: `LAB ${site.name} r${site.revision}`,
                      url,
                      targetId: target.id,
                      pages: 1,
                    });
                    onAssessment(a.id);
                  }, 'Queued real lab assessment.')
                }
              />
            ))}
          </div>
        </>
      )}
      {view === 'journeys' && (
        <>
          <JourneyEditor
            data={data}
            busy={busy}
            save={(value) =>
              run(
                () => opsApi('journeys', value),
                'Journey definition saved. It will execute only configured actions within the permitted target. Approvals remain manual.',
              )
            }
          />
          <section className="panel ops-form">
            <h2>Saved journeys</h2>
            {data.journeys.length ? (
              data.journeys.map((j) => (
                <JourneyRun
                  key={j.id}
                  journey={j}
                  data={data}
                  busy={busy}
                  run={(url) =>
                    run(async () => {
                      const a = await opsApi('assessments', {
                        name: `Journey · ${j.name}`,
                        url,
                        targetId: j.targetId,
                        journeyId: j.id,
                        pages: 1,
                      });
                      onAssessment(a.id);
                    }, 'Journey queued for actual browser execution.')
                  }
                />
              ))
            ) : (
              <p className="field-help">
                No journeys saved. Use a controlled lab form to demonstrate validation errors and
                recovery.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
function LabEditor({
  site,
  data,
  busy,
  save,
  scan,
}: {
  site: WorkspaceData['labSites'][number];
  data: WorkspaceData;
  busy: boolean;
  save: (c: LabConfig, n: string) => void;
  scan: (u: string) => void;
}) {
  const [config, setConfig] = useState(site.revisions[0].config),
    [notes, setNotes] = useState('');
  const target = data.targets.find((t) => t.pathPrefix === `/site/${site.id}`);
  if (!target) return null;
  const url = target.origin + target.pathPrefix;
  return (
    <section className="panel ops-form">
      <h2>{site.name}</h2>
      <p className="field-help">Controlled build revision {site.revision}</p>
      <a className="text-button" href={url} target="_blank" rel="noreferrer">
        Open actual website
        <ArrowUpRight size={14} />
      </a>
      {Object.entries({
        imageAlt: 'Provide image alternative text',
        formLabels: 'Associate the email form label',
        contrast: 'Use sufficient text contrast',
      }).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={config[key as keyof LabConfig]}
            onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(config, notes);
        }}
      >
        <label htmlFor={'notes-' + site.id}>Build change notes</label>
        <input
          id={'notes-' + site.id}
          minLength={10}
          required
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="button primary" disabled={busy || data.user.role !== 'admin'}>
          Save new build revision
        </button>
      </form>
      <div className="button-row">
        <button className="button secondary" onClick={() => scan(url)} disabled={busy}>
          Assess home
        </button>
        <button className="button secondary" onClick={() => scan(url + '/form')} disabled={busy}>
          Assess form
        </button>
      </div>
      <details>
        <summary>Build history</summary>
        {site.revisions.map((r) => (
          <p className="field-help" key={r.id}>
            Revision {r.version}: {r.notes} · {r.actor}
          </p>
        ))}
      </details>
    </section>
  );
}
type Step = {
  name: string;
  action: string;
  selector: string;
  value: string;
  url: string;
  scan: boolean;
};
function JourneyEditor({
  data,
  busy,
  save,
}: {
  data: WorkspaceData;
  busy: boolean;
  save: (v: unknown) => void;
}) {
  const [name, setName] = useState(''),
    [targetId, setTargetId] = useState(data.targets[0]?.id ?? ''),
    [submit, setSubmit] = useState(false),
    [steps, setSteps] = useState<Step[]>([
      { name: 'Open form', action: 'goto', selector: '', value: '', url: '', scan: true },
    ]);
  return (
    <section className="panel ops-form">
      <h2>Configure a safe browser journey</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            name,
            targetId,
            allowSubmission: submit,
            steps: steps.map((s) => ({
              name: s.name,
              action: s.action,
              scan: s.scan,
              ...(s.action === 'goto' ? { url: s.url } : { selector: s.selector }),
              ...(['fill', 'press'].includes(s.action) ? { value: s.value } : {}),
            })),
          });
        }}
      >
        <label htmlFor="journey-name">Journey name</label>
        <input
          id="journey-name"
          required
          minLength={3}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="journey-target">Permitted target</label>
        <select id="journey-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {data.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />{' '}
          Explicitly permit form submission under this target policy
        </label>
        <p className="field-help">
          No arbitrary JavaScript or shell commands. Only goto, fill, click, press and check actions
          are accepted. Values are stored privately to execute the journey and excluded from scan
          configuration exports. Avoid credentials and sensitive data.
        </p>
        {steps.map((s, i) => (
          <fieldset key={i} style={{ margin: '18px 0', padding: 16 }}>
            <legend>Step {i + 1}</legend>
            <div className="journey-step-grid">
              {(
                [
                  'name',
                  'action',
                  ...(s.action === 'goto' ? ['url'] : ['selector']),
                  ...(['fill', 'press'].includes(s.action) ? ['value'] : []),
                ] as (keyof Step)[]
              ).map((k) => (
                <div key={k}>
                  <label htmlFor={`step-${i}-${k}`}>{k}</label>
                  {k === 'action' ? (
                    <select
                      id={`step-${i}-${k}`}
                      value={s.action}
                      onChange={(e) =>
                        setSteps(
                          steps.map((x, n) => (n === i ? { ...x, action: e.target.value } : x)),
                        )
                      }
                    >
                      {['goto', 'fill', 'click', 'press', 'check'].map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`step-${i}-${k}`}
                      required={k !== 'value'}
                      value={String(s[k])}
                      onChange={(e) =>
                        setSteps(steps.map((x, n) => (n === i ? { ...x, [k]: e.target.value } : x)))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={s.scan}
                onChange={(e) =>
                  setSteps(steps.map((x, n) => (n === i ? { ...x, scan: e.target.checked } : x)))
                }
              />{' '}
              Scan this resulting state
            </label>
            <button
              type="button"
              className="text-button"
              disabled={steps.length === 1}
              onClick={() => setSteps(steps.filter((_, n) => i !== n))}
            >
              Remove step
            </button>
          </fieldset>
        ))}
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={steps.length >= 12}
            onClick={() =>
              setSteps([
                ...steps,
                { name: '', action: 'click', selector: '', value: '', url: '', scan: true },
              ])
            }
          >
            Add step
          </button>
          <button className="button primary" disabled={busy}>
            Save journey definition
          </button>
        </div>
      </form>
    </section>
  );
}
function JourneyRun({
  journey: j,
  data,
  busy,
  run,
}: {
  journey: WorkspaceData['journeys'][number];
  data: WorkspaceData;
  busy: boolean;
  run: (u: string) => void;
}) {
  const t = data.targets.find((t) => t.id === j.targetId),
    [url, setUrl] = useState(t ? t.origin + t.pathPrefix : '');
  return (
    <article className="backlog-item">
      <div className="backlog-main">
        <h3>
          {j.name} · {j.steps.length} configured steps
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(url);
          }}
        >
          <label htmlFor={'start-' + j.id}>Starting URL</label>
          <input
            id={'start-' + j.id}
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="button primary" disabled={busy}>
            <Activity size={16} />
            Execute real journey
          </button>
        </form>
      </div>
    </article>
  );
}
