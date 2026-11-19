import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { Archive } from './components/Archive';
import { Timeline } from './components/Timeline';
import { Dashboard } from './components/Dashboard';
import { Settings } from './components/Settings';
import { SyncStatus } from './components/SyncStatus';
import { useRealtime } from './hooks/useRealtime';
import { supabase } from './lib/supabase';

const TABS = [['dash', 'Dashboard'], ['plan', 'Pianifica'], ['archive', 'Archivio'], ['settings', 'Impostazioni']] as const;

function Shell() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('plan');
  const live = useRealtime();
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-lg font-semibold">PrintFlow</h1>
        <nav className="flex gap-1">{TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : ''}`}>{l}</button>))}</nav>
        <span className="flex-1" />
        <SyncStatus live={live} />
        <button aria-label="Esci" onClick={() => supabase.auth.signOut()} className="p-2"><LogOut className="h-4 w-4" /></button>
      </header>
      {tab === 'dash' ? <Dashboard /> : tab === 'plan' ? <Timeline /> : tab === 'archive' ? <Archive /> : <Settings />}
    </>
  );
}
export default function App() { return <AuthGate>{() => <Shell />}</AuthGate>; }
