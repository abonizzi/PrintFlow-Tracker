import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { useBulkComplete, useJobs } from '../hooks/useJobs';
import { computeStats } from '../lib/stats';
import { TZ_DEFAULT as TZ, fmtTime, todayStr } from '../lib/time';
import { fmtDuration } from '../lib/types';
import { StatusActions } from './StatusActions';
import { ImportWizard } from './ImportWizard';
import { download, exportCalendarText, exportCsv, exportJson } from '../lib/exporters';
import { exportPdf } from '../lib/exportPdf';
import { downloadBackup } from '../lib/backup';

const Card = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-xs opacity-70">{label}</p><p className="text-xl font-semibold">{value}</p>{sub && <p className="text-xs opacity-70">{sub}</p>}</div>
);
const range = (s: string, e: string) => `${fmtTime(s, TZ, 'dd/MM HH:mm')}–${fmtTime(e)}`;

export function Dashboard() {
  const { data: jobs = [], isLoading } = useJobs(); const { data: av } = useAvailability(); const bulk = useBulkComplete();
  const [now, setNow] = useState(new Date()); const [sel, setSel] = useState<Set<string>>(new Set()); const [showImport, setShowImport] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const gap = av?.settings?.changeover_minutes ?? 15;
  const st = useMemo(() => computeStats(jobs, now, gap), [jobs, now, gap]);
  const due = jobs.filter(j => (j.status === 'scheduled' || j.status === 'in_progress') && j.planned_start && new Date(j.planned_start) <= now)
    .sort((x, y) => new Date(x.planned_start!).getTime() - new Date(y.planned_start!).getTime());
  const chosen = due.filter(j => sel.has(j.id));
  const days = Object.entries(st.perDay).filter(([d]) => d >= todayStr()).sort(([x], [y]) => x.localeCompare(y)).slice(0, 14);
  if (isLoading) return <p className="p-4">Caricamento…</p>;
  return (
    <section className="mx-auto max-w-4xl space-y-5 p-4">
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900" onClick={() => setShowImport(true)}>Importa stampe</button>
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={() => download(`printflow_${todayStr()}.json`, exportJson(jobs, gap), 'application/json')}>Esporta JSON</button>
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={() => download(`printflow_${todayStr()}.csv`, exportCsv(jobs), 'text/csv')}>Esporta CSV</button>
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={() => exportPdf(jobs, gap).catch(e => alert((e as Error).message))}>Esporta PDF</button>
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={() => download(`printflow_calendario_${todayStr()}.txt`, exportCalendarText(jobs), 'text/plain')}>Calendario (testo)</button>
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={() => downloadBackup().catch(e => alert((e as Error).message))}>Backup</button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="Lavorazioni totali" value={st.total} />
        <Card label="Da programmare" value={st.toSchedule} sub={st.optionalPending ? `${st.optionalPending} opzionali non confermate` : undefined} />
        <Card label="Programmate" value={st.scheduled} />
        <Card label="In corso" value={st.inProgress} />
        <Card label="Completate" value={st.completed} sub={`${st.completionPct}% del lavoro`} />
        <Card label="Ore di stampa residue" value={fmtDuration(st.remainingMin)} sub="escluse le opzionali" />
        <Card label="Tempo libero tra stampe" value={fmtDuration(Math.round(st.idleMin))} sub="dalle lavorazioni future" />
        <Card label="Conflitti" value={st.conflicts.length} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold">Prossima stampa</h2>
        {st.next ? <p>{st.next.name} · {range(st.next.planned_start!, st.next.planned_end!)}</p> : <p className="opacity-60">Nessuna stampa programmata in futuro.</p>}
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Ore programmate per giorno</h2>
        {days.length === 0 && <p className="text-sm opacity-60">Niente in programma.</p>}
        <ul className="space-y-1">{days.map(([d, m]) => (
          <li key={d} className="flex items-center gap-2 text-sm"><span className="w-24 shrink-0">{d.slice(8)}/{d.slice(5, 7)}</span>
            <div className="h-3 flex-1 rounded bg-slate-200 dark:bg-slate-800"><div className="h-3 rounded bg-blue-600" style={{ width: `${Math.min(100, (m / 1440) * 100)}%` }} /></div>
            <span className="w-16 shrink-0 text-right">{fmtDuration(Math.round(m))}</span></li>))}</ul>
      </div>
      {st.conflicts.length > 0 && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
        <h2 className="font-semibold">Conflitti nel calendario</h2>
        {st.conflicts.map(c => <p key={c.a.id + c.b.id}>• «{c.a.name}» ({range(c.a.planned_start!, c.a.planned_end!)}) e «{c.b.name}» ({range(c.b.planned_start!, c.b.planned_end!)}):
          {c.reason === 'overlap' ? ' si sovrappongono' : ` meno di ${gap} min per il cambio piatto`}</p>)}</div>}
      <div>
        <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Da confermare ({due.length})</h2>
          <button disabled={!chosen.length || bulk.isPending} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => bulk.mutate(chosen, { onSuccess: () => setSel(new Set()), onError: e => alert((e as Error).message) })}>Conferma completate ({chosen.length})</button></div>
        <p className="mb-2 text-xs opacity-70">Stampe con inizio già passato. Restano "programmate" finché non le confermi tu.</p>
        <ul className="space-y-2">{due.map(j => (
          <li key={j.id} className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={sel.has(j.id)}
              onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(j.id) : n.delete(j.id); return n; })} />
              <span className="flex-1 truncate font-medium">{j.name}</span><span className="opacity-70">{range(j.planned_start!, j.planned_end!)}</span></label>
            <details className="mt-1"><summary className="cursor-pointer text-xs underline">Azioni</summary><StatusActions job={j} /></details></li>))}
          {due.length === 0 && <li className="text-sm opacity-60">Nessuna stampa da confermare.</li>}</ul>
      </div>
      {showImport && <ImportWizard onClose={() => setShowImport(false)} />}
    </section>
  );
}
