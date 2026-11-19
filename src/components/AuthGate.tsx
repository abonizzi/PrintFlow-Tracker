import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function AuthGate({ children }: { children: (s: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!ready) return <p className="p-6">Caricamento…</p>;
  return session ? <>{children(session)}</> : <LoginForm />;
}

function LoginForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('');
    const { error, data } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === 'up' && !data.session) setMsg('Controlla la tua email per confermare la registrazione.');
  }
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900';
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">PrintFlow</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={input} type="email" required placeholder="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={8} placeholder="Password (min. 8)" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} />
        <button disabled={busy} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {mode === 'in' ? 'Accedi' : 'Registrati'}
        </button>
      </form>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <button className="text-sm underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
      </button>
    </main>
  );
}
