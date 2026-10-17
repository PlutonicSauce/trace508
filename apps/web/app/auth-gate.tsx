'use client';
import { useState, useEffect, type ReactNode } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{ setupRequired: boolean; user: unknown } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [accept, setAccept] = useState(false);
  useEffect(() => {
    const expired = () => setStatus({ setupRequired: false, user: null });
    window.addEventListener('trace508-session-expired', expired);
    return () => window.removeEventListener('trace508-session-expired', expired);
  }, []);
  useEffect(() => {
    fetch('/api/auth/status')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? 'Authentication service unavailable');
        return data;
      })
      .then(setStatus)
      .catch(() => setError('Authentication service unavailable. Check the server and database.'));
  }, []);
  if (!status)
    return (
      <main className="auth-shell">
        <ShieldCheck size={32} />
        <h1>Trace508 assurance workspace</h1>
        <p role="status">{error || 'Checking session…'}</p>
      </main>
    );
  if (status.user) return children;
  return (
    <main className="auth-shell">
      <section className="panel form-panel">
        <ShieldCheck size={32} />
        <h1>{status.setupRequired ? 'Initialize your workspace' : 'Sign in to Trace508'}</h1>
        <p>
          {status.setupRequired
            ? 'A trusted server operator must issue a bootstrap token. Legacy evidence adoption requires explicit operator authorization.'
            : 'Use your administrator-provided account. Access and decisions use your authenticated identity.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const form = new FormData(e.currentTarget);
            try {
              const r = await fetch(
                  '/api/auth/' + (accept ? 'accept' : status.setupRequired ? 'setup' : 'login'),
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.fromEntries(form)),
                  },
                ),
                d = await r.json();
              if (!r.ok) throw new Error(d.error);
              location.reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {status.setupRequired && !accept && (
            <>
              <label htmlFor="setup-name">Your name</label>
              <input id="setup-name" name="name" minLength={2} required autoComplete="name" />
              <label htmlFor="setup-org">Organization name</label>
              <input id="setup-org" name="organization" minLength={2} required />
            </>
          )}
          {(status.setupRequired || accept) && (
            <>
              <label htmlFor="account-token">
                {accept ? 'Invitation or recovery token' : 'Operator bootstrap token'}
              </label>
              <input
                id="account-token"
                name="token"
                type="password"
                required
                minLength={32}
                autoComplete="off"
              />
            </>
          )}
          {!accept && (
            <>
              <label htmlFor="login-email">Email address</label>
              <input id="login-email" type="email" name="email" required autoComplete="username" />
            </>
          )}
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            name="password"
            required
            minLength={accept || status.setupRequired ? 15 : 1}
            maxLength={200}
            autoComplete={status.setupRequired ? 'new-password' : 'current-password'}
          />
          <p className="field-help">
            New passwords require at least 15 characters. Session cookies expire after 8 hours.
          </p>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}{' '}
            {accept
              ? 'Accept invitation or recover account'
              : status.setupRequired
                ? 'Create administrator'
                : 'Sign in'}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setAccept(!accept);
            setError('');
          }}
        >
          {accept ? 'Return to sign in' : 'Use an invitation or recovery token'}
        </button>
      </section>
    </main>
  );
}
