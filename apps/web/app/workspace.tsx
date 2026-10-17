'use client';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Code2,
  Columns2,
  FileCheck2,
  FileText,
  FolderClock,
  Globe2,
  Layers3,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import type { AssessmentDetail } from '@core/assessment';
import type { matrix } from '@core/assessment';
import type { benchmark } from '@core/benchmark';
import { Operations, type WorkspaceData, opsApi } from './operations';
type Detail = AssessmentDetail & { matrix: ReturnType<typeof matrix> };
type Summary = {
  id: string;
  name: string;
  url: string;
  variant: string;
  status: string;
  progress: string;
  createdAt: string;
  _count: { findings: number; pages: number; tasks: number };
};
type View =
  | 'overview'
  | 'create'
  | 'scan'
  | 'findings'
  | 'finding'
  | 'matrix'
  | 'review'
  | 'remediation'
  | 'compare'
  | 'reports'
  | 'history'
  | 'journeys'
  | 'lab'
  | 'settings';
const labels: Record<View, string> = {
  overview: 'Assessment overview',
  create: 'New assessment',
  scan: 'Scan activity',
  findings: 'Findings explorer',
  finding: 'Finding evidence',
  matrix: 'Compliance matrix',
  review: 'Human review',
  remediation: 'Remediation backlog',
  compare: 'Before / After',
  reports: 'Draft ACR reports',
  history: 'Assessment history',
  journeys: 'Journey assurance',
  lab: 'Controlled test lab',
  settings: 'Project & access',
};
const nav: { view: View; icon: typeof Activity; label: string }[] = [
  { view: 'overview', icon: LayoutDashboard, label: 'Overview' },
  { view: 'findings', icon: Search, label: 'Findings explorer' },
  { view: 'matrix', icon: Layers3, label: 'Compliance matrix' },
  { view: 'review', icon: ClipboardCheck, label: 'Human review' },
  { view: 'remediation', icon: ListChecks, label: 'Remediation backlog' },
  { view: 'compare', icon: Columns2, label: 'Before / After' },
  { view: 'reports', icon: FileText, label: 'ACR reports' },
  { view: 'history', icon: FolderClock, label: 'Assessment history' },
  { view: 'journeys', icon: Activity, label: 'Journey assurance' },
  { view: 'lab', icon: Code2, label: 'Controlled test lab' },
  { view: 'settings', icon: ShieldCheck, label: 'Project & access' },
];
const date = (value: Date | string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
async function api<T = unknown>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(
    `/api/${url}`,
    body === undefined
      ? { cache: 'no-store' }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event('trace508-session-expired'));
  if (!response.ok)
    throw new Error(
      data.error +
        (data.details
          ? ' · ' +
            data.details
              .map((d: { field: string; message: string }) => `${d.field}: ${d.message}`)
              .join(', ')
          : ''),
    );
  return data;
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Layers3 size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  note: string;
  icon: typeof Activity;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}
export default function Workspace() {
  const [view, setView] = useState<View>('overview'),
    [selected, setSelected] = useState(''),
    [findingId, setFindingId] = useState('');
  const [assessments, setAssessments] = useState<Summary[]>([]),
    [a, setA] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [severity, setSeverity] = useState('all'),
    [pageFilter, setPageFilter] = useState('all');
  const [health, setHealth] = useState<{ gemini: boolean; database: boolean } | null>(null);
  const [operations, setOperations] = useState<WorkspaceData | null>(null);
  const refreshOperations = useCallback(async () => {
    const data = await opsApi<WorkspaceData>('workspace');
    setOperations(data);
    setHealth({ database: true, gemini: data.gemini });
  }, []);
  useEffect(() => {
    void refreshOperations().catch((e) => setError(e.message));
  }, [refreshOperations]);
  const initialized = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const navigate = useCallback(
    (next: View, id?: string, fid?: string) => {
      setView(next);
      setQuery('');
      setError('');
      if (id) {
        selectedRef.current = id;
        setSelected(id);
        setA(null);
      }
      if (fid) setFindingId(fid);
      const params = new URLSearchParams({ view: next });
      if (id ?? selected) params.set('assessment', id ?? selected);
      if (fid) params.set('finding', fid);
      window.history.pushState({}, '', `/?${params}`);
      document.getElementById('page-title')?.focus();
    },
    [selected],
  );
  const refresh = useCallback(async () => {
    try {
      const rows = await api<Summary[]>('assessments');
      setAssessments(rows);
      if (!selectedRef.current && rows.length)
        setSelected(
          (rows.find((r) => r.variant === 'before' && r.status === 'completed') ?? rows[0]).id,
        );
      if (selected) {
        const detail = await api<Detail>(`assessments/${selected}`);
        if (selectedRef.current === selected) setA(detail);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);
  useEffect(() => {
    const read = () => {
      const p = new URLSearchParams(location.search);
      const v = p.get('view') as View;
      if (v && labels[v]) setView(v);
      if (p.get('assessment')) {
        selectedRef.current = p.get('assessment')!;
        setSelected(p.get('assessment')!);
      }
      if (p.get('finding')) setFindingId(p.get('finding')!);
    };
    read();
    initialized.current = true;
    window.addEventListener('popstate', read);
    api<{ gemini: boolean; database: boolean }>('health')
      .then(setHealth)
      .catch(() => {});
    return () => window.removeEventListener('popstate', read);
  }, []);
  useEffect(() => {
    if (!initialized.current) return;
    setA(null);
    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      setError('');
      await action();
      setNotice(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const active = assessments.filter((x) => ['queued', 'running'].includes(x.status));
  const findings =
    a?.findings.filter(
      (f) =>
        (severity === 'all' || f.impact === severity) &&
        (pageFilter === 'all' || f.pageId === pageFilter) &&
        `${f.help} ${f.ruleId} ${f.mappings.map((m) => m.requirementId).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  const currentFinding = a?.findings.find((f) => f.id === findingId);
  const needsAssessment = ![
    'overview',
    'create',
    'compare',
    'history',
    'journeys',
    'lab',
    'settings',
  ].includes(view);
  const reviews = a?.tasks.filter((t) => t.status === 'open').length ?? 0;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate('overview');
          }}
        >
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            trace<span className="brand-number">508</span>
            <small>ACCESSIBILITY WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-chip">
          <span className="workspace-icon">U</span>
          <span>
            {operations?.project.name ?? 'Trace508 assurance'}
            <small>Authenticated project workspace</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(({ view: v, icon: Icon, label }) => (
            <a
              key={v}
              href={`/?view=${v}${selected ? '&assessment=' + selected : ''}`}
              aria-current={view === v ? 'page' : undefined}
              aria-label={label}
              className={
                view === v || (view === 'finding' && v === 'findings')
                  ? 'nav-item selected'
                  : 'nav-item'
              }
              onClick={(e) => {
                e.preventDefault();
                navigate(v);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {v === 'review' && reviews > 0 && <b className="nav-count">{reviews}</b>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="integrity">
            <ShieldCheck size={20} />
            <strong>Evidence comes first</strong>
            <p>
              Every finding traced.
              <br />
              Every decision recorded.
            </p>
            <span>WCAG 2.0 A & AA</span>
          </div>
          <div className="local-user">
            <span className="avatar">L</span>
            <span>
              {operations?.user.name ?? 'Signed-in user'}
              <small>{operations?.user.role ?? 'Authenticated'}</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>{labels[view]}</span>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <span className="online-dot" />
              {health?.database ? 'Database connected' : 'Connecting to database'}
            </span>
            <span className="divider" />
            {operations && (
              <select
                className="project-selector"
                aria-label="Active project"
                value={operations.project.id}
                onChange={async (e) => {
                  await opsApi('projects/switch', { projectId: e.target.value });
                  location.href = '/';
                }}
              >
                {operations.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isFixture ? ' · TEST FIXTURE' : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              className="text-button"
              onClick={async () => {
                await opsApi('auth/logout', {});
                location.reload();
              }}
            >
              Sign out
            </button>
            <span className="avatar small">L</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {operations?.project.isFixture && (
            <div className="fixture-banner">
              ISOLATED TEST FIXTURE PROJECT · Its assessments and test reviewer actions are separate
              from live project data.
            </div>
          )}
          {a?.variant === 'lab' && (
            <div className="fixture-banner">
              CONTROLLED LAB ASSESSMENT · Real browser execution against an intentionally
              configurable test website. Build: {a.buildLabel ?? 'not captured yet'}.
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">ACCESSIBILITY OPERATIONS</div>
              <h1 id="page-title" tabIndex={-1}>
                {labels[view]}
              </h1>
              <p>
                {view === 'overview'
                  ? 'A clear path from accessibility evidence to defensible decisions.'
                  : view === 'compare'
                    ? 'Compare real scanner evidence against the published W3C evaluation.'
                    : view === 'reports'
                      ? 'Assemble reviewer-ready drafts from your persisted assessment evidence.'
                      : view === 'review'
                        ? 'Apply human judgment where automation cannot establish conformance.'
                        : view === 'matrix'
                          ? 'Trace each criterion to scanner evidence and human validation.'
                          : view === 'remediation'
                            ? 'Turn observed barriers into a transparent, prioritized plan.'
                            : view === 'findings'
                              ? 'Explore observed barriers, affected elements, and supporting evidence.'
                              : view === 'history'
                                ? 'A permanent record of scans, review decisions, and changes.'
                                : view === 'create'
                                  ? 'Assess a permitted website or a configured browser journey.'
                                  : 'Original technical evidence, preserved for review.'}
              </p>
            </div>
            {view !== 'create' && (
              <button className="button primary" onClick={() => navigate('create')}>
                <Plus size={16} />
                New assessment
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                <XCircle size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button className="text-button" onClick={() => setNotice('')}>
                Dismiss
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading" role="status">
              <Loader2 className="spin" />
              Loading persisted assessments…
            </div>
          ) : (
            <>
              {needsAssessment && (
                <div className="assessment-picker">
                  <label htmlFor="assessment">Assessment</label>
                  <select
                    id="assessment"
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setPageFilter('all');
                      setFindingId('');
                    }}
                  >
                    {!assessments.length && <option value="">No assessments</option>}
                    {assessments.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · {x.status}
                      </option>
                    ))}
                  </select>
                  {a && (
                    <Badge
                      tone={
                        a.status === 'completed' ? 'green' : a.status === 'failed' ? 'red' : 'amber'
                      }
                    >
                      {a.status}
                    </Badge>
                  )}
                </div>
              )}
              {(['journeys', 'lab', 'settings'] as string[]).includes(view) && operations && (
                <Operations
                  view={view as 'journeys' | 'lab' | 'settings'}
                  data={operations}
                  onRefresh={refreshOperations}
                  onAssessment={(id) => navigate('scan', id)}
                />
              )}
              {view === 'create' && (
                <CreateAssessment
                  data={operations}
                  onCreate={(id) => {
                    setNotice('Assessment queued. The worker will record live scan progress here.');
                    navigate('scan', id);
                  }}
                />
              )}
              {view === 'overview' && (
                <>
                  <div className="metrics">
                    <Metric
                      label="Assessments"
                      value={assessments.length}
                      note={`${active.length} queued or running`}
                      icon={Globe2}
                    />
                    <Metric
                      label="Observed rule violations"
                      value={assessments.reduce((n, r) => n + r._count.findings, 0)}
                      note="Actual scanner findings across assessments"
                      icon={TriangleAlert}
                    />
                    <Metric
                      label="Pages in scope"
                      value={assessments.reduce((n, r) => n + r._count.pages, 0)}
                      note="Selected pages across all assessments"
                      icon={Layers3}
                    />
                    <Metric
                      label="Human review tasks"
                      value={assessments.reduce((n, r) => n + r._count.tasks, 0)}
                      note="Includes open and completed tasks"
                      icon={ClipboardCheck}
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="panel assessment-feature">
                      <div className="section-heading">
                        <div className="kicker">
                          <span className="online-dot" />
                          ASSESSMENT SPOTLIGHT
                        </div>
                        <Badge tone="green">Evidence workspace</Badge>
                      </div>
                      {a ? (
                        <>
                          <div className="feature-title">
                            <span className="site-icon">
                              <Globe2 size={24} />
                            </span>
                            <div>
                              <h2>{a.name}</h2>
                              <p>{a.url}</p>
                            </div>
                          </div>
                          <div className="feature-facts">
                            <div>
                              <span>Evaluation scope</span>
                              <strong>WCAG 2.0 A / AA</strong>
                            </div>
                            <div>
                              <span>Pages selected</span>
                              <strong>{a.pages.length} pages</strong>
                            </div>
                            <div>
                              <span>Scan state</span>
                              <strong>{a.status}</strong>
                            </div>
                          </div>
                          <div className="feature-line" />
                          <div className="feature-bottom">
                            <p>
                              <ShieldCheck size={18} />
                              Automated evidence collected.
                              <br />
                              <span>Human validation establishes the conclusion.</span>
                            </p>
                            <button
                              className="button primary"
                              onClick={() =>
                                navigate(
                                  a.status === 'running' || a.status === 'queued'
                                    ? 'scan'
                                    : 'findings',
                                  a.id,
                                )
                              }
                            >
                              Open assessment
                              <ArrowRight size={16} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <Empty
                          title={
                            assessments.length
                              ? 'Loading assessment evidence…'
                              : 'Your first assessment starts here'
                          }
                        >
                          {assessments.length
                            ? 'Retrieving the selected assessment and evidence records.'
                            : 'Create an assessment to collect real evidence from a permitted W3C page.'}
                        </Empty>
                      )}
                    </section>
                    <section className="panel readiness">
                      <div className="section-heading">
                        <h2>Reporting readiness</h2>
                        <FileCheck2 size={18} />
                      </div>
                      <div className="readiness-number">
                        {a?.matrix.filter((r) => r.ready).length ?? 0}
                        <span>/ 38</span>
                      </div>
                      <p>WCAG criteria with scoped decisions</p>
                      <div className="progress-track">
                        <div
                          style={{
                            width: `${((a?.matrix.filter((r) => r.ready).length ?? 0) / 38) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="readiness-note">
                        <Clock3 size={18} />
                        <span>Conformance remains unresolved until the evidence is reviewed.</span>
                      </div>
                      <button className="text-button" onClick={() => navigate('matrix')}>
                        View compliance matrix
                        <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Assessments</h2>
                        <p>Your evidence collection and validation activity</p>
                      </div>
                      <button className="text-button" onClick={() => navigate('history')}>
                        View history
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                    {assessments.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Assessment / source</th>
                              <th scope="col">Status</th>
                              <th scope="col">Pages</th>
                              <th scope="col">Findings</th>
                              <th scope="col">Created</th>
                              <th scope="col">
                                <span className="sr-only">Open</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {assessments.map((x) => (
                              <tr key={x.id}>
                                <td>
                                  <button
                                    className="table-title"
                                    onClick={() =>
                                      navigate(
                                        ['running', 'queued'].includes(x.status)
                                          ? 'scan'
                                          : 'findings',
                                        x.id,
                                      )
                                    }
                                  >
                                    {x.name}
                                  </button>
                                  <small className="table-sub">{x.url}</small>
                                </td>
                                <td>
                                  <Badge
                                    tone={
                                      x.status === 'completed'
                                        ? 'green'
                                        : x.status === 'failed'
                                          ? 'red'
                                          : 'amber'
                                    }
                                  >
                                    {x.status === 'completed' ? 'Scan complete' : x.status}
                                  </Badge>
                                </td>
                                <td>{x._count.pages}</td>
                                <td>
                                  <strong>{x._count.findings}</strong>
                                </td>
                                <td className="muted">{date(x.createdAt)}</td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`Open ${x.name}`}
                                    onClick={() => navigate('findings', x.id)}
                                  >
                                    <ArrowUpRight size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="No assessments yet">
                        Start a real scan to build your evidence workspace.
                      </Empty>
                    )}
                  </section>
                  <div className="workflow-grid">
                    {[
                      {
                        title: 'Inspect the evidence',
                        text: 'Follow each finding to the affected element and original scanner output.',
                        icon: Code2,
                        v: 'findings',
                      },
                      {
                        title: 'Bring human judgment',
                        text: 'Record observations, validate findings, and review criterion conclusions.',
                        icon: ClipboardCheck,
                        v: 'review',
                      },
                      {
                        title: 'Build a defensible draft',
                        text: 'Export a draft ACR with stable references and unresolved decisions visible.',
                        icon: FileText,
                        v: 'reports',
                      },
                    ].map(({ title, text, icon: Icon, v }) => (
                      <button key={v} className="workflow-card" onClick={() => navigate(v as View)}>
                        <span className="workflow-icon">
                          <Icon size={21} />
                        </span>
                        <h3>
                          {title}
                          <ArrowUpRight size={16} />
                        </h3>
                        <p>{text}</p>
                      </button>
                    ))}
                  </div>
                  <div className="footnote">
                    <ShieldCheck size={15} />
                    Evidence-backed assessments. No automatic conformance claims.
                    <span>Unissant Challenge X · Trace508</span>
                  </div>
                </>
              )}
              {needsAssessment && !a && (
                <Empty title={assessments.length ? 'Loading assessment' : 'No assessment selected'}>
                  {assessments.length
                    ? 'Retrieving the latest evidence from PostgreSQL.'
                    : 'Create an assessment to begin collecting evidence.'}
                </Empty>
              )}
              {view === 'scan' && a && (
                <section className="panel scan-panel">
                  <Activity size={32} />
                  <h2>{a.name}</h2>
                  <Badge
                    tone={
                      a.status === 'completed' ? 'green' : a.status === 'failed' ? 'red' : 'amber'
                    }
                  >
                    {a.status}
                  </Badge>
                  <p role="status" aria-live="polite">
                    {a.progress}
                  </p>
                  {a.error && <div className="alert error">{a.error}</div>}
                  {a.parentId && (
                    <div className="button-row">
                      <button
                        className="text-button"
                        onClick={() => navigate('remediation', a.parentId!)}
                      >
                        Return to original issue lifecycle
                      </button>
                    </div>
                  )}
                  {a.journeySteps.length > 0 && (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Journey step</th>
                            <th scope="col">Action</th>
                            <th scope="col">Outcome</th>
                            <th scope="col">Page transition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.journeySteps.map((s) => (
                            <tr key={s.id}>
                              <td>
                                {s.index + 1}. {s.name}
                              </td>
                              <td>{s.action}</td>
                              <td>
                                {s.status}
                                {s.error && <p className="error-text">{s.error}</p>}
                              </td>
                              <td>
                                {s.beforeUrl} → {s.afterUrl ?? 'pending'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <ol className="scan-steps">
                    {[
                      'Destination validated and assessment queued',
                      'Chromium navigates approved pages',
                      'axe tests WCAG 2.0 A and AA',
                      'Evidence and review tasks persist',
                    ].map((s, i) => (
                      <li key={s}>
                        <span>{i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  <div className="scan-summary">
                    {a.pages.filter((p) => p.evidence.length).length} / {a.pages.length} pages have
                    persisted scan evidence · {a.findings.length} violated rules
                  </div>
                  <div className="button-row">
                    {['queued', 'running'].includes(a.status) ? (
                      <button
                        className="button danger"
                        onClick={() =>
                          act(
                            () => api(`assessments/${a.id}/cancel`, {}),
                            'Cancellation requested.',
                          )
                        }
                      >
                        Cancel scan
                      </button>
                    ) : (
                      <button className="button primary" onClick={() => navigate('findings')}>
                        Inspect findings
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                  <p className="muted">
                    Progress reflects worker stages, not an estimated percentage. Partial evidence
                    from stopped jobs is retained.
                  </p>
                </section>
              )}
              {view === 'findings' && a && (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>
                        Observed accessibility barriers{' '}
                        <span className="count">{a.findings.length}</span>
                      </h2>
                      <p>
                        One finding per rule and page. Each affected element has its own evidence
                        record.
                      </p>
                    </div>
                    <Badge>axe-core · WCAG 2.0</Badge>
                  </div>
                  <div className="filters">
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search findings"
                        placeholder="Search rule, finding, or criterion…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Filter severity"
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                    >
                      <option value="all">All severities</option>
                      {['critical', 'serious', 'moderate', 'minor'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter page"
                      value={pageFilter}
                      onChange={(e) => setPageFilter(e.target.value)}
                    >
                      <option value="all">All pages</option>
                      {a.pages.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.url.split('/').pop()}
                        </option>
                      ))}
                    </select>
                  </div>
                  {findings.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Finding</th>
                            <th scope="col">Impact</th>
                            <th scope="col">Requirement</th>
                            <th scope="col">Page</th>
                            <th scope="col">Evidence</th>
                            <th scope="col">
                              <span className="sr-only">Inspect</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {findings.map((f) => (
                            <tr key={f.id}>
                              <td>
                                <button
                                  className="table-title"
                                  onClick={() => navigate('finding', a.id, f.id)}
                                >
                                  {f.help}
                                </button>
                                <small className="table-sub mono">{f.ruleId}</small>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    f.impact === 'critical'
                                      ? 'red'
                                      : f.impact === 'serious'
                                        ? 'orange'
                                        : 'amber'
                                  }
                                >
                                  {f.impact}
                                </Badge>
                              </td>
                              <td>
                                {f.mappings.map((m) => (
                                  <span className="criterion-tag" key={m.requirementId}>
                                    {m.requirementId}
                                  </span>
                                ))}
                              </td>
                              <td>
                                {a.pages
                                  .find((p) => p.id === f.pageId)
                                  ?.url.split('/')
                                  .pop()}
                              </td>
                              <td>{f.evidence.length} elements</td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Inspect ${f.ruleId} evidence`}
                                  onClick={() => navigate('finding', a.id, f.id)}
                                >
                                  <ChevronRight size={17} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty title="No matching findings">
                      {a.status === 'completed'
                        ? 'No violated rules match these filters. This does not establish WCAG conformance.'
                        : a.progress}
                    </Empty>
                  )}
                </section>
              )}
              {view === 'finding' &&
                a &&
                (currentFinding ? (
                  <FindingDetail
                    a={a}
                    f={currentFinding}
                    gemini={health?.gemini ?? false}
                    onExplain={() =>
                      act(
                        () => api(`findings/${currentFinding.id}/explain`, {}),
                        'AI suggestion saved. Human verification remains required.',
                      )
                    }
                    onReview={() => navigate('review')}
                    onBack={() => navigate('findings')}
                  />
                ) : (
                  <Empty title="Select a finding">
                    Open a finding from the explorer to inspect its evidence.
                  </Empty>
                ))}
              {view === 'matrix' && a && (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>
                        WCAG 2.0 A / AA <span className="count">38 criteria</span>
                      </h2>
                      <p>
                        Section 508 E205.4 / E207.2 · Associations describe partial test coverage.
                      </p>
                    </div>
                    <Badge tone="amber">Human ratification required</Badge>
                  </div>
                  <div className="filters">
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search criteria"
                        placeholder="Search criterion, title, or level…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Criterion</th>
                          <th scope="col">Level</th>
                          <th scope="col">Automated evidence</th>
                          <th scope="col">Human review</th>
                          <th scope="col">Draft conclusion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.matrix
                          .filter((r) =>
                            `${r.id} ${r.title} ${r.level}`
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                          )
                          .map((r) => (
                            <tr key={r.id}>
                              <td>
                                <a
                                  className="table-title"
                                  href={r.source}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {r.id} {r.title}
                                  <ArrowUpRight size={12} />
                                </a>
                                <small className="table-sub">{r.section508}</small>
                              </td>
                              <td>{r.level}</td>
                              <td>
                                {r.findings.length
                                  ? `${r.findings.length} findings · ${r.evidenceIds.length} elements`
                                  : 'No violation observed'}
                                <small className="table-sub">Limited automated coverage</small>
                              </td>
                              <td>
                                <button className="text-button" onClick={() => navigate('review')}>
                                  {r.reviewOpen} open {r.contradictory ? '· conflict' : ''}
                                </button>
                              </td>
                              <td>
                                <Badge tone={r.ready ? 'green' : 'amber'}>
                                  {r.conclusion ?? 'Unresolved draft'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel-note">
                    No violation observed is an automated outcome. It is never used as a Supports
                    conclusion. Official ICT Baseline test procedures are linked in the review
                    workflow.
                  </div>
                </section>
              )}
              {view === 'review' && a && (
                <ReviewWorkspace
                  a={a}
                  refresh={refresh}
                  setError={setError}
                  setNotice={setNotice}
                />
              )}
              {view === 'remediation' && a && (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>Prioritized remediation</h2>
                      <p>
                        Priority follows scanner impact: critical P1, serious P2, moderate P3, minor
                        P4.
                      </p>
                    </div>
                    <Badge>Deterministic ranking</Badge>
                  </div>
                  {a.findings.length ? (
                    <div className="backlog">
                      {[...a.findings]
                        .sort(
                          (x, y) =>
                            (x.remediation?.priority ?? 5) - (y.remediation?.priority ?? 5) ||
                            x.ruleId.localeCompare(y.ruleId),
                        )
                        .map((f) => (
                          <RemediationCard
                            key={f.id}
                            f={f}
                            onInspect={() => navigate('finding', a.id, f.id)}
                            onRetest={async () => {
                              try {
                                const r = await api<{ id: string }>(
                                  `remediation/${f.remediation!.id}/retest`,
                                  {},
                                );
                                navigate('scan', r.id);
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                            onVerify={(outcome, notes) =>
                              act(
                                () =>
                                  api(`remediation/${f.remediation!.id}/verify`, {
                                    outcome,
                                    notes,
                                  }),
                                'Verification action recorded. Criterion conformance remains separate.',
                              )
                            }
                            onSave={(status, notes) =>
                              act(
                                () =>
                                  api(
                                    `remediation/${f.remediation!.id}`,
                                    { status, notes },
                                    'PATCH',
                                  ),
                                'Remediation status saved. Re-scan and human verification remain required.',
                              )
                            }
                          />
                        ))}
                    </div>
                  ) : (
                    <Empty title="No remediation items">
                      Items are generated only from actual scanner findings.
                    </Empty>
                  )}
                </section>
              )}
              {view === 'compare' && (
                <Comparison
                  assessments={assessments}
                  onFinding={(id, fid) => navigate('finding', id, fid)}
                  setError={setError}
                />
              )}
              {view === 'reports' && a && (
                <>
                  <section className="panel ops-form">
                    <h2>Independent evidence package</h2>
                    <p className="field-help">
                      Download original source files, screenshots, requirements, findings, decisions
                      and lifecycle history with content hashes. Hashes detect modification; these
                      packages are not signed.
                    </p>
                    <button
                      className="button secondary"
                      onClick={() =>
                        act(
                          () => api(`assessments/${a.id}/packages`, {}),
                          'Evidence package created. Download and verify independently.',
                        )
                      }
                    >
                      Create evidence package
                    </button>
                    {a.packages.map((p) => (
                      <div className="button-row" key={p.id}>
                        <a className="text-button" href={`/api/packages/${p.id}`}>
                          Evidence ZIP {p.id.slice(0, 8)}
                        </a>
                        <a className="text-button" href={`/api/packages/${p.id}/digest`}>
                          SHA-256 digest
                        </a>
                      </div>
                    ))}
                  </section>
                  <div className="report-grid">
                    <section className="panel report-cover">
                      <div className="report-icon">
                        <FileText size={32} />
                      </div>
                      <div className="eyebrow">REVISED SECTION 508 EDITION</div>
                      <h2>
                        Accessibility
                        <br />
                        Conformance Report
                      </h2>
                      <p>{a.name}</p>
                      <div className="report-rule" />
                      <Badge tone="amber">Working draft · incomplete evaluation</Badge>
                      <p className="muted">
                        WCAG 2.0 A / AA
                        <br />
                        ITI VPAT® 2.5Rev 508 reference structure
                      </p>
                    </section>
                    <section className="panel report-details">
                      <h2>Evidence-backed, ready for review</h2>
                      <p>
                        Generate a real Word document and a companion evidence manifest from the
                        current persisted records.
                      </p>
                      <ul className="checklist">
                        <li>
                          <Check size={17} />
                          {a.findings.length} observed rule violations with traceable evidence
                        </li>
                        <li>
                          <Check size={17} />
                          {a.tasks.filter((t) => t.status === 'resolved').length} saved human-review
                          decisions
                        </li>
                        <li>
                          <Clock3 size={17} />
                          {a.matrix.filter((r) => !r.ready).length} WCAG criteria remain unresolved
                        </li>
                        <li>
                          <Clock3 size={17} />
                          Chapter applicability and report owner metadata need ratification
                        </li>
                      </ul>
                      <div className="alert neutral">
                        <ShieldCheck size={20} />
                        <span>
                          Unresolved conformance cells stay blank. Final approval is blocked in this
                          release. Review chapter scope and complete the official VPAT® before
                          procurement use.
                        </span>
                      </div>
                      <GenerateButton
                        disabled={a.status !== 'completed'}
                        onGenerate={() =>
                          act(
                            () => api('reports', { assessmentId: a.id }),
                            'Draft DOCX and evidence manifest generated.',
                          )
                        }
                      />
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Generated report snapshots</h2>
                      <span className="muted">Immutable evidence references</span>
                    </div>
                    {a.reports.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Snapshot</th>
                              <th scope="col">Created</th>
                              <th scope="col">Status</th>
                              <th scope="col">Downloads</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.reports.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <strong>Draft ACR v{r.version}</strong>
                                  {r.changes && (
                                    <details>
                                      <summary>Evidence changes</summary>
                                      <pre className="report-diff">
                                        {JSON.stringify(r.changes, null, 2)}
                                      </pre>
                                    </details>
                                  )}
                                  <small className="table-sub mono">
                                    {r.id.slice(0, 8)} · SHA-256 {r.sha256.slice(0, 16)}…
                                  </small>
                                </td>
                                <td>{date(r.createdAt)}</td>
                                <td>
                                  <Badge tone="amber">{r.status}</Badge>
                                </td>
                                <td>
                                  <div className="button-row">
                                    <a
                                      className="button secondary compact"
                                      href={`/api/reports/${r.id}`}
                                    >
                                      <ArrowDownToLine size={15} />
                                      DOCX
                                    </a>
                                    <a
                                      className="button secondary compact"
                                      href={`/api/reports/${r.id}/manifest`}
                                    >
                                      Evidence JSON
                                    </a>
                                    {r.openacr && (
                                      <a
                                        className="button secondary compact"
                                        href={`/api/reports/${r.id}/openacr`}
                                      >
                                        Validated OpenACR
                                      </a>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="No reports generated">
                        Generate a draft after the scan completes. Every export saves a new
                        snapshot.
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {view === 'history' && (
                <>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Assessment ledger</h2>
                      <span className="muted">{assessments.length} persisted assessments</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Assessment</th>
                            <th scope="col">Created</th>
                            <th scope="col">Status</th>
                            <th scope="col">Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assessments.map((x) => (
                            <tr key={x.id}>
                              <td>
                                <button className="table-title" onClick={() => setSelected(x.id)}>
                                  {x.name}
                                </button>
                                <small className="table-sub mono">{x.id}</small>
                              </td>
                              <td>{date(x.createdAt)}</td>
                              <td>
                                <Badge>{x.status}</Badge>
                              </td>
                              <td>
                                {x._count.findings} rule violations
                                {operations?.user.role === 'admin' && (
                                  <details>
                                    <summary>Retention / deletion</summary>
                                    <form
                                      onSubmit={async (e) => {
                                        e.preventDefault();
                                        const confirm = String(
                                          new FormData(e.currentTarget).get('confirm'),
                                        );
                                        try {
                                          await api(`assessments/${x.id}`, { confirm }, 'DELETE');
                                          location.href = '/';
                                        } catch (e) {
                                          setError((e as Error).message);
                                        }
                                      }}
                                    >
                                      <label htmlFor={'delete-' + x.id}>
                                        Type assessment ID to permanently delete evidence
                                      </label>
                                      <input
                                        id={'delete-' + x.id}
                                        name="confirm"
                                        required
                                        pattern={x.id}
                                      />
                                      <button className="button danger compact">
                                        Permanently delete assessment
                                      </button>
                                    </form>
                                  </details>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Audit events{a ? ' · ' + a.name : ''}</h2>
                    </div>
                    {a?.events.length ? (
                      <div className="timeline">
                        {a.events.map((e) => (
                          <div className="timeline-item" key={e.id}>
                            <span className="timeline-dot" />
                            <div>
                              <strong>{e.action.replaceAll('-', ' ')}</strong>
                              <p>{e.detail}</p>
                              <small>
                                {e.actor} · {date(e.createdAt)}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="No audit events">
                        Select an assessment to inspect its history.
                      </Empty>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function CreateAssessment({
  onCreate,
  data,
}: {
  onCreate: (id: string) => void;
  data: WorkspaceData | null;
}) {
  const [targetId, setTargetId] = useState(''),
    [journeyId, setJourneyId] = useState(''),
    [extraUrls, setExtraUrls] = useState('');
  const [name, setName] = useState(''),
    [url, setUrl] = useState('https://www.w3.org/WAI/demos/bad/before/home.html'),
    [pages, setPages] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="create-grid">
      <section className="panel form-panel">
        <h2>Define your assessment</h2>
        <p>
          Choose the version and pages to evaluate. Findings will come from actual browser
          execution.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const r = await api<{ id: string }>('assessments', {
                name,
                url,
                pages,
                targetId: targetId || undefined,
                journeyId: journeyId || undefined,
                urls: extraUrls.trim()
                  ? extraUrls
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : undefined,
              });
              onCreate(r.id);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="assessment-name">Assessment name</label>
          <input
            id="assessment-name"
            autoComplete="off"
            required
            minLength={3}
            maxLength={100}
            placeholder="e.g. CityLights accessibility baseline"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="registered-target">Permitted target policy</label>
          <select
            id="registered-target"
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              const t = data?.targets.find((t) => t.id === e.target.value);
              if (t) setUrl(t.origin + t.pathPrefix);
              setPages(1);
            }}
          >
            <option value="">Match URL to a registered target</option>
            {data?.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label htmlFor="scan-url">Permitted website URL</label>
          <input
            id="scan-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="preset-row">
            <button
              type="button"
              className="preset"
              onClick={() => {
                setUrl('https://www.w3.org/WAI/demos/bad/before/home.html');
                if (!name) setName('W3C CityLights · Before');
              }}
            >
              W3C Before
              <ArrowUpRight size={13} />
            </button>
            <button
              type="button"
              className="preset"
              onClick={() => {
                setUrl('https://www.w3.org/WAI/demos/bad/after/home.html');
                if (!name) setName('W3C CityLights · After');
              }}
            >
              W3C After
              <ArrowUpRight size={13} />
            </button>
          </div>
          <label htmlFor="scope">Page scope</label>
          <select id="scope" value={pages} onChange={(e) => setPages(Number(e.target.value))}>
            <option value={1}>Selected page only</option>
            <option value={4}>Four demonstration pages: home, news, tickets, survey</option>
          </select>
          <p className="field-help">
            Register additional public HTTPS origins in Project & access. Internal network addresses
            are blocked. Only the explicitly configured controlled lab has a bounded loopback
            exception.
          </p>
          <label htmlFor="additional-urls">Additional in-scope URLs (optional, one per line)</label>
          <textarea
            id="additional-urls"
            rows={3}
            value={extraUrls}
            onChange={(e) => setExtraUrls(e.target.value)}
          />
          <label htmlFor="assessment-journey">Saved journey (optional)</label>
          <select
            id="assessment-journey"
            value={journeyId}
            onChange={(e) => {
              setJourneyId(e.target.value);
              const j = data?.journeys.find((j) => j.id === e.target.value);
              if (j) setTargetId(j.targetId);
              setPages(1);
            }}
          >
            <option value="">Page assessment only</option>
            {data?.journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
          <div className="form-divider" />
          <div className="scope-summary">
            <ShieldCheck size={20} />
            <span>
              <strong>WCAG 2.0 Level A and AA</strong>
              <small>Playwright + axe-core · bounded scanning · persistent evidence</small>
            </span>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={17} /> : <Activity size={17} />}{' '}
            {busy ? 'Validating destination…' : 'Start real assessment'}
          </button>
        </form>
      </section>
      <aside className="create-aside">
        <div className="eyebrow">WHAT HAPPENS NEXT</div>
        <h2>
          Evidence you can
          <br />
          follow all the way.
        </h2>
        <ol>
          {[
            [
              '01',
              'Scan the real page',
              'Chromium opens the permitted URL. axe runs only WCAG 2.0 A and AA checks.',
            ],
            [
              '02',
              'Preserve the observation',
              'Store original output, affected elements, HTML, hashes, and screenshots.',
            ],
            [
              '03',
              'Add human judgment',
              'Review findings and criteria before drawing conformance conclusions.',
            ],
          ].map(([n, t, d]) => (
            <li key={n}>
              <span>{n}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="alert neutral">
          <Target size={22} />
          <p>
            The W3C demonstration contains intentional barriers. Reference evaluation data is kept
            separate from scanner findings.
          </p>
        </div>
      </aside>
    </div>
  );
}
function FindingDetail({
  a,
  f,
  gemini,
  onExplain,
  onReview,
  onBack,
}: {
  a: Detail;
  f: Detail['findings'][number];
  gemini: boolean;
  onExplain: () => Promise<void>;
  onReview: () => void;
  onBack: () => void;
}) {
  const [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false);
  const e = f.evidence[index] ?? f.evidence[0];
  const ai = f.ai as {
    explanation?: string;
    remediation?: string;
    verification?: string;
    evidenceIds?: string[];
    reviewQuestions?: string[];
  } | null;
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        ← All findings
      </button>
      <section className="panel finding-header">
        <Badge tone={f.impact === 'critical' ? 'red' : 'orange'}>{f.impact}</Badge>
        <h2>{f.help}</h2>
        <p>{f.description}</p>
        <div className="finding-meta">
          <code>{f.ruleId}</code>
          <span>{a.pages.find((p) => p.id === f.pageId)?.url}</span>
        </div>
        <div>
          {f.mappings.map((m) => (
            <a
              className="criterion-tag"
              key={m.requirementId}
              href={m.requirement.source}
              target="_blank"
              rel="noreferrer"
            >
              WCAG {m.requirementId} · {m.requirement.title}
              <ArrowUpRight size={12} />
            </a>
          ))}
        </div>
      </section>
      <div className="evidence-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Technical evidence</h2>
              <p>Original scanner observation · {f.evidence.length} affected elements</p>
            </div>
            <select
              aria-label="Select affected element"
              value={index}
              onChange={(v) => setIndex(Number(v.target.value))}
            >
              {f.evidence.map((x, i) => (
                <option key={x.id} value={i}>
                  Element {i + 1}
                </option>
              ))}
            </select>
          </div>
          {e && (
            <div className="evidence-body">
              <dl className="evidence-dl">
                <dt>Evidence ID</dt>
                <dd>
                  <code>{e.id}</code>
                </dd>
                <dt>DOM selector</dt>
                <dd>
                  <code>{e.selector}</code>
                </dd>
                <dt>Captured</dt>
                <dd>{date(e.createdAt)}</dd>
                <dt>SHA-256</dt>
                <dd className="hash">{e.sha256}</dd>
              </dl>
              <h3>HTML excerpt</h3>
              <pre>
                <code>{e.html}</code>
              </pre>
              <h3>Observed failure conditions</h3>
              <pre className="failure-text">{e.summary}</pre>
              <div className="button-row">
                <a
                  className="button secondary compact"
                  href={`/api/evidence/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Code2 size={15} />
                  Raw evidence JSON
                </a>
                <a className="text-button" href={f.helpUrl} target="_blank" rel="noreferrer">
                  Rule documentation
                  <ArrowUpRight size={14} />
                </a>
              </div>
              <details className="screenshot">
                <summary>View captured page screenshot</summary>
                <img
                  alt={`Full page captured while scanning ${f.ruleId}. The affected element is identified by the selector above.`}
                  src={`/api/evidence/${e.id}/screenshot`}
                />
              </details>
            </div>
          )}
        </section>
        <div className="detail-side">
          <section className="panel ai-panel">
            <div className="section-heading">
              <h2>
                <Sparkles size={18} />
                AI assistance
              </h2>
              <Badge>{gemini ? 'Configured provider' : 'Not configured'}</Badge>
            </div>
            {ai?.explanation ? (
              <>
                <h3>Suggested explanation</h3>
                <p>{ai.explanation}</p>
                <h3>Suggested remediation</h3>
                <p>{ai.remediation}</p>
                <h3>Verification</h3>
                <p>{ai.verification}</p>
                <small>Evidence: {ai.evidenceIds?.join(', ')}</small>
                <h3>Review questions</h3>
                <ul>
                  {ai.reviewQuestions?.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                {gemini
                  ? 'Generate structured guidance grounded in the supplied evidence.'
                  : 'Configure AI_PROVIDER=ollama for local inference, or explicitly enable a cloud provider on the server. Original scanner fix guidance is available below.'}
              </p>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onExplain();
                setBusy(false);
              }}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}Generate
              explanation
            </button>
            <p className="field-help">
              Suggestions require verification. AI cannot approve conformance or modify scanner
              results.
            </p>
          </section>
          <section className="panel guidance-panel">
            <h2>Remediation guidance</h2>
            <p>{f.remediation?.guidance}</p>
            <h3>Verification steps</h3>
            <p>{f.remediation?.verification}</p>
            <button className="text-button" onClick={onReview}>
              Open human review
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
function ReviewWorkspace({
  a,
  refresh,
  setError,
  setNotice,
}: {
  a: Detail;
  refresh: () => Promise<void>;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [kind, setKind] = useState('criterion'),
    [status, setStatus] = useState('open'),
    [chosen, setChosen] = useState(''),
    [search, setSearch] = useState('');
  const tasks = a.tasks.filter(
    (t) =>
      t.kind === kind &&
      (status === 'all' || t.status === status) &&
      `${t.requirementId} ${t.requirement.title} ${t.page.url}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const t = tasks.find((x) => x.id === chosen) ?? tasks[0];
  return (
    <div className="review-layout">
      <section className="panel task-list">
        <div className="panel-header">
          <h2>Review queue</h2>
          <span className="count">{tasks.length}</span>
        </div>
        <div className="task-filters">
          <label className="sr-only" htmlFor="review-kind">
            Task type
          </label>
          <select id="review-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="criterion">Criterion conformance</option>
            <option value="finding">Validate findings</option>
          </select>
          <select
            aria-label="Review status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Open tasks</option>
            <option value="resolved">Resolved tasks</option>
            <option value="all">All tasks</option>
          </select>
          <input
            aria-label="Search review tasks"
            placeholder="Search criterion or page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="task-items">
          {tasks.map((task) => (
            <button
              className={t?.id === task.id ? 'task-item active' : 'task-item'}
              key={task.id}
              onClick={() => setChosen(task.id)}
            >
              <span className="task-criterion">
                {task.requirementId}
                <Badge tone={task.status === 'resolved' ? 'green' : 'amber'}>{task.status}</Badge>
              </span>
              <strong>{task.requirement.title}</strong>
              <small>
                {task.page.url.split('/').pop()} ·{' '}
                {task.kind === 'finding' ? 'Scanner validation' : 'Criterion decision'}
              </small>
            </button>
          ))}
          {!tasks.length && (
            <Empty title="No matching tasks">
              Change the task type or status to see other review work.
            </Empty>
          )}
        </div>
      </section>
      {t ? (
        <ReviewForm
          key={t.id}
          task={t}
          a={a}
          onSave={async (body) => {
            try {
              setError('');
              await api(`reviews/${t.id}`, body);
              setNotice('Reviewer decision saved in the audit history.');
              await refresh();
            } catch (e) {
              setError((e as Error).message);
              throw e;
            }
          }}
        />
      ) : (
        <section className="panel">
          <Empty title="Select a review task">
            Criterion review and finding validation are separate decisions.
          </Empty>
        </section>
      )}
    </div>
  );
}
function ReviewForm({
  task: t,
  a,
  onSave,
}: {
  task: Detail['tasks'][number];
  a: Detail;
  onSave: (body: unknown) => Promise<void>;
}) {
  const [reviewer, setReviewer] = useState(''),
    [notes, setNotes] = useState(''),
    [observation, setObservation] = useState(''),
    [outcome, setOutcome] = useState(''),
    [busy, setBusy] = useState(false),
    [ids, setIds] = useState<string[]>([]);
  const evidence = [
    ...a.pages.filter((p) => p.id === t.pageId).flatMap((p) => p.evidence),
    ...a.findings
      .filter((f) => f.pageId === t.pageId && (!t.findingId || f.id === t.findingId))
      .flatMap((f) => f.evidence),
  ];
  return (
    <section className="panel review-form">
      <div className="section-heading">
        <Badge>{t.kind === 'criterion' ? 'Criterion conformance' : 'Finding validation'}</Badge>
        <span className="mono muted">{t.requirementId}</span>
      </div>
      <h2>{t.requirement.title}</h2>
      <p className="muted">{t.page.url}</p>
      <div className="alert neutral">
        <ClipboardCheck size={21} />
        <p>{t.reason}</p>
      </div>
      <a
        className="text-button"
        href="https://ictbaseline.access-board.gov/web-baselines/"
        target="_blank"
        rel="noreferrer"
      >
        Official ICT Baseline test guidance
        <ArrowUpRight size={14} />
      </a>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              reviewer,
              notes,
              outcome,
              evidenceIds: ids,
              ...(observation ? { observation } : {}),
            });
            setNotes('');
            setObservation('');
          } catch {
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="two-fields">
          <div>
            <label htmlFor="reviewer">Authenticated reviewer</label>
            <input
              id="reviewer"
              required
              minLength={2}
              maxLength={100}
              value="Your authenticated account"
              readOnly
              placeholder="Enter your name"
            />
          </div>
          <div>
            <label htmlFor="outcome">Decision</label>
            <select
              id="outcome"
              required
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="">Choose a decision</option>
              {(t.kind === 'criterion'
                ? ['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'reopen']
                : ['confirmed', 'rejected', 'reopen']
              ).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label htmlFor="observation">
          Human observation{' '}
          {t.kind === 'criterion' && outcome !== 'reopen' ? '(required)' : '(optional)'}
        </label>
        <textarea
          id="observation"
          minLength={30}
          required={t.kind === 'criterion' && outcome !== 'reopen'}
          rows={4}
          placeholder="Describe your actual test steps, browser or assistive technology, element, and observed result. Do not infer a pass from an automated scan."
          value={observation}
          onChange={(e) => setObservation(e.target.value)}
        />
        <label htmlFor="review-notes">Decision rationale and scope</label>
        <textarea
          id="review-notes"
          required
          minLength={30}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Explain why the evidence supports this decision and identify any scope limits."
        />
        <fieldset className="evidence-selection">
          <legend>Link supporting scanner evidence</legend>
          <div>
            {evidence.map((e) => (
              <label key={e.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(e.id)}
                  onChange={(v) =>
                    setIds(v.target.checked ? [...ids, e.id] : ids.filter((id) => id !== e.id))
                  }
                />
                <span>
                  <code>{e.id}</code>
                  <small>
                    {e.kind} · {e.summary.slice(0, 100)}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="field-help">
          Decisions use your signed-in account identity. Saved observations are permanent evidence.
          A Supports decision with unresolved scanner violations is flagged as a conflict in the
          matrix.
        </p>
        <button className="button primary" disabled={busy || a.status !== 'completed'}>
          {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Save reviewer
          decision
        </button>
      </form>
      <div className="decision-history">
        <h3>Decision history</h3>
        {t.decisions.length ? (
          t.decisions.map((d) => (
            <div key={d.id}>
              <Badge>{d.outcome}</Badge>
              <strong>{d.reviewer}</strong>
              <small>{date(d.createdAt)}</small>
              <p>{d.notes}</p>
              <small>Evidence: {(d.evidenceIds as string[]).join(', ')}</small>
            </div>
          ))
        ) : (
          <p className="muted">No reviewer decisions recorded.</p>
        )}
      </div>
    </section>
  );
}
function RemediationCard({
  f,
  onInspect,
  onSave,
  onRetest,
  onVerify,
}: {
  onRetest: () => Promise<void>;
  onVerify: (outcome: string, notes: string) => Promise<void>;
  f: Detail['findings'][number];
  onInspect: () => void;
  onSave: (status: string, notes: string) => Promise<void>;
}) {
  const [status, setStatus] = useState('remediation-proposed'),
    [notes, setNotes] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <article className="backlog-item">
      <span className={`priority p${f.remediation?.priority}`}>P{f.remediation?.priority}</span>
      <div className="backlog-main">
        <div className="backlog-title">
          <button className="table-title" onClick={onInspect}>
            {f.help}
          </button>
          <Badge tone="orange">{f.impact}</Badge>
        </div>
        <div className="issue-state">
          <Badge tone={f.remediation?.status === 'verified-resolved' ? 'green' : 'amber'}>
            {f.remediation?.status ?? 'open'}
          </Badge>
        </div>
        <p>{f.remediation?.guidance}</p>
        <div className="button-row">
          <button
            className="button secondary compact"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRetest();
              setBusy(false);
            }}
          >
            Run independent retest
          </button>
        </div>
        {f.remediation?.retests.map((r) => (
          <p className="field-help" key={r.id}>
            Retest {r.assessment.id.slice(0, 8)}: {r.assessment.status} · {r.outcome}.{' '}
            {r.explanation}
          </p>
        ))}

        <div className="backlog-meta">
          <code>{f.ruleId}</code>
          <span>WCAG {f.mappings.map((m) => m.requirementId).join(', ')}</span>
          <span>{f.evidence.length} affected elements</span>
        </div>
        <details>
          <summary>Verification and workflow</summary>
          <p>{f.remediation?.verification}</p>
          <div className="button-row">
            <button className="text-button" onClick={onInspect}>
              Inspect selectors and evidence
              <ArrowUpRight size={14} />
            </button>
          </div>
          <form
            className="remediation-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await onSave(status, notes);
              setBusy(false);
            }}
          >
            <select
              aria-label={`Status for ${f.ruleId}`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="remediation-proposed">Remediation proposed</option>
              <option value="implementation-claimed">Implementation claimed</option>
              <option value="awaiting-retest">Awaiting retest</option>
            </select>
            <input
              aria-label={`Change notes for ${f.ruleId}`}
              required
              minLength={15}
              placeholder="Record change notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button className="button secondary compact" disabled={busy}>
              Save status
            </button>
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fdata = new FormData(e.currentTarget);
              setBusy(true);
              await onVerify(String(fdata.get('outcome')), String(fdata.get('notes')));
              setBusy(false);
            }}
          >
            <label htmlFor={'verify-notes-' + f.id}>Human verification observation</label>
            <textarea
              id={'verify-notes-' + f.id}
              name="notes"
              minLength={50}
              required
              rows={3}
              placeholder="Record actual keyboard or assistive technology test steps, the observed result, and limitations."
            />
            <select name="outcome" aria-label={'Verification outcome ' + f.ruleId}>
              <option value="verified-resolved">
                Verify issue resolved after independent retest
              </option>
              <option value="reopened">Reopen issue</option>
            </select>
            <button className="button secondary compact" disabled={busy}>
              Save human verification
            </button>
          </form>
          <div className="state-history">
            <h3>Issue lifecycle history</h3>
            {f.remediation?.events.map((e) => (
              <p key={e.id}>
                <strong>{e.status}</strong> · {date(e.createdAt)} · {e.actor}
                <br />
                {e.notes}
              </p>
            ))}
          </div>
        </details>
      </div>
    </article>
  );
}
function Comparison({
  assessments,
  onFinding,
  setError,
}: {
  assessments: Summary[];
  onFinding: (id: string, fid: string) => void;
  setError: (s: string) => void;
}) {
  const [before, setBefore] = useState(''),
    [after, setAfter] = useState(''),
    [result, setResult] = useState<ReturnType<typeof benchmark> | null>(null),
    [filter, setFilter] = useState('all'),
    [adjudicate, setAdjudicate] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!before)
      setBefore(
        assessments.find((a) => a.variant === 'before' && a.status === 'completed')?.id ?? '',
      );
    if (!after)
      setAfter(
        assessments.find((a) => a.variant === 'after' && a.status === 'completed')?.id ?? '',
      );
  }, [assessments, before, after]);
  useEffect(() => {
    setResult(null);
    if (before && after)
      api<ReturnType<typeof benchmark>>(`compare?before=${before}&after=${after}`)
        .then(setResult)
        .catch((e) => setError(e.message));
  }, [before, after, setError, revision]);
  const b = assessments.find((a) => a.id === before),
    a = assessments.find((a) => a.id === after);
  return (
    <>
      <div className="compare-select">
        <div>
          <label htmlFor="before-assessment">Before assessment</label>
          <select id="before-assessment" value={before} onChange={(e) => setBefore(e.target.value)}>
            <option value="">Select Before assessment</option>
            {assessments
              .filter((a) => a.variant === 'before')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.status}
                </option>
              ))}
          </select>
        </div>
        <Columns2 size={25} />
        <div>
          <label htmlFor="after-assessment">After assessment</label>
          <select id="after-assessment" value={after} onChange={(e) => setAfter(e.target.value)}>
            <option value="">Select After assessment</option>
            {assessments
              .filter((a) => a.variant === 'after')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.status}
                </option>
              ))}
          </select>
        </div>
      </div>
      {result ? (
        <>
          <div className="compare-stats">
            <section className="panel compare-before">
              <div className="eyebrow">BEFORE · ORIGINAL WEBSITE</div>
              <strong>{result.beforeFindingCount}</strong>
              <p>Observed rule violations across matching scope</p>
              <Badge tone="orange">{b?.status}</Badge>
            </section>
            <section className="panel compare-after">
              <div className="eyebrow">AFTER · RETROFITTED WEBSITE</div>
              <strong>{result.afterFindingCount}</strong>
              <p>Observed rule violations · investigate before adjudication</p>
              <Badge tone="green">{a?.status}</Badge>
            </section>
            <section className="panel">
              <div className="eyebrow">VERIFIED REFERENCE DISCOVERY</div>
              <strong>
                {result.verifiedNumerator}
                <span> / {result.denominator}</span>
              </strong>
              <p>
                {result.completed
                  ? `${Math.round((result.verifiedRecall ?? 0) * 100)}% verified category discovery`
                  : 'Incomplete scan pair'}
              </p>
              <Badge tone={result.targetAchieved ? 'green' : 'amber'}>
                {result.targetAchieved
                  ? '90% category target reached; scope limited'
                  : '90% target not demonstrated'}
              </Badge>
            </section>
          </div>
          <div className="alert neutral">
            <Target size={22} />
            <span>
              {result.warning}{' '}
              <strong>
                {result.candidateNumerator} / {result.denominator} provisional category matches.
              </strong>
            </span>
          </div>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Published W3C reference barriers</h2>
                <p>
                  {result.methodology}. Matching pages: {result.pages.join(', ')}.
                </p>
              </div>
              <select
                aria-label="Filter reference matches"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All reference units</option>
                <option value="candidate">Candidate matches</option>
                <option value="missed">Missed / manual</option>
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Page</th>
                    <th scope="col">Criterion</th>
                    <th scope="col">Scanner association / adjudication</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues
                    .filter(
                      (i) =>
                        filter === 'all' ||
                        (filter === 'candidate'
                          ? i.candidateFindingIds.length
                          : !i.candidateFindingIds.length),
                    )
                    .map((i) => (
                      <tr key={i.id}>
                        <td>
                          <a
                            className="table-title"
                            href={i.source}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {i.failure}
                            <ArrowUpRight size={12} />
                          </a>
                        </td>
                        <td>{i.page}.html</td>
                        <td>{i.criterion}</td>
                        <td>
                          {i.status === 'verified match' ? (
                            <Badge tone="green">Verified category match</Badge>
                          ) : i.candidateFindingIds.length ? (
                            <>
                              <Badge tone="amber">Candidate match</Badge>
                              {i.candidateFindingIds.map((fid) => (
                                <button
                                  className="text-button compact"
                                  key={fid}
                                  onClick={() => onFinding(before, fid)}
                                >
                                  Inspect evidence
                                  <ArrowUpRight size={12} />
                                </button>
                              ))}
                            </>
                          ) : (
                            <span className="muted">{i.status}</span>
                          )}
                          <button
                            className="text-button compact"
                            onClick={() => setAdjudicate(i.id)}
                          >
                            Review reference match
                            <ArrowRight size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="panel-note">
              {result.unmatchedBefore.length} unmatched Before findings ·{' '}
              {result.afterFalsePositiveCandidates.length} After findings requiring investigation ·
              Human decisions: Before {result.humanReview.before}, After {result.humanReview.after}.
              Category associations do not establish instance-level recall or precision.
            </div>
          </section>
          {adjudicate && (
            <BenchmarkForm
              key={adjudicate}
              assessmentId={before}
              issue={result.issues.find((i) => i.id === adjudicate)!}
              onClose={() => setAdjudicate('')}
              onSaved={() => {
                setRevision((v) => v + 1);
                setAdjudicate('');
              }}
            />
          )}
        </>
      ) : (
        <section className="panel">
          <Empty title="Choose a completed scan pair">
            Run real Before and After assessments to compare matching pages. Reference issues never
            populate scan findings.
          </Empty>
        </section>
      )}
    </>
  );
}
function GenerateButton({
  disabled,
  onGenerate,
}: {
  disabled: boolean;
  onGenerate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="button primary"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        await onGenerate();
        setBusy(false);
      }}
    >
      {busy ? <Loader2 className="spin" size={17} /> : <ArrowDownToLine size={17} />}{' '}
      {busy ? 'Generating draft…' : 'Generate draft DOCX'}
    </button>
  );
}

function BenchmarkForm({
  assessmentId,
  issue,
  onClose,
  onSaved,
}: {
  assessmentId: string;
  issue: ReturnType<typeof benchmark>['issues'][number];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reviewer, setReviewer] = useState(''),
    [findingId, setFindingId] = useState(''),
    [outcome, setOutcome] = useState(''),
    [notes, setNotes] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    document.getElementById('benchmark-review-heading')?.focus();
  }, []);
  return (
    <section className="panel review-form">
      <div className="section-heading">
        <h2 id="benchmark-review-heading" tabIndex={-1}>
          Adjudicate reference {issue.id}
        </h2>
        <button className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="field-help">
        Compare the published barrier with the actual finding and its DOM evidence. Record the
        specific elements and test steps you used. This decision affects only benchmark category
        discovery.
      </p>
      {!issue.eligibleFindings.length ? (
        <p>
          No scanner findings match this page and criterion. A missed barrier remains unresolved.
          Perform a separate human evaluation.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const finding = issue.eligibleFindings.find((f) => f.id === findingId)!;
              await api('benchmark-decisions', {
                assessmentId,
                referenceId: issue.id,
                findingId,
                reviewer,
                outcome,
                notes,
                evidenceIds: finding.evidenceIds,
              });
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="benchmark-reviewer">Authenticated reviewer</label>
          <input
            id="benchmark-reviewer"
            required
            minLength={2}
            value="Your authenticated account"
            readOnly
          />
          <label htmlFor="benchmark-finding">Supporting scanner finding</label>
          <select
            id="benchmark-finding"
            required
            value={findingId}
            onChange={(e) => setFindingId(e.target.value)}
          >
            <option value="">Select finding after inspecting its evidence</option>
            {issue.eligibleFindings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.help} · {f.id}
              </option>
            ))}
          </select>
          <label htmlFor="benchmark-outcome">Reference match decision</label>
          <select
            id="benchmark-outcome"
            required
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">Choose decision</option>
            <option value="matched">Verified category match</option>
            <option value="rejected">Reject match</option>
            <option value="reopen">Reopen adjudication</option>
          </select>
          <label htmlFor="benchmark-notes">Observed correspondence and test steps</label>
          <textarea
            id="benchmark-notes"
            required
            minLength={50}
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe the actual reference barrier and affected element, and why the scanner evidence does or does not match."
          />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            Save reference decision
          </button>
        </form>
      )}
      <div className="decision-history">
        <h3>Reference decision history</h3>
        {issue.decisions.length ? (
          issue.decisions.map((d) => (
            <div key={d.id}>
              <Badge>{d.outcome}</Badge>
              <strong>{d.reviewer}</strong>
              <p>{d.notes}</p>
              <small>{date(d.createdAt)}</small>
            </div>
          ))
        ) : (
          <p className="muted">No reference decisions recorded.</p>
        )}
      </div>
    </section>
  );
}
