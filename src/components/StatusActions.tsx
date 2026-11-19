import { useState } from 'react';
import { useSetStatus, type Job } from '../hooks/useJobs';
import { TZ_DEFAULT as TZ, fmtTime, fromInputValue, toInputValue } from '../lib/time';
import { STATUS_LABEL, type JobStatus } from '../lib/types';

const b = 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700';
const inp = 'w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-700';

export function StatusActions({ job, onDone }: { job: Job; onDone?: () => void }) {
  const set = useSetStatus();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(job.actual_start ? toInputValue(job.actual_start, TZ) : '');
  const [z, setZ] = useState(job.actual_end ? toInputValue(job.actual_end, TZ) : '');
  const bad = !!a && !!z && fromInputValue(z, TZ) <= fromInputValue(a, TZ);
  const run = (status: JobStatus, extra: { actual_start?: string | null; actual_end?: string | null } = {}) =>
    set.mutate({ job, status, ...extra }, { onSuccess: () => onDone?.(), onError: e => alert((e as Error).message) });
  const s = job.status;
  return (
    <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800">
      <p className="text-sm">Stato: <b>{STATUS_LABEL[s]}</b>
        {(job.actual_start || job.actual_end) && <> · Effettivo: {job.actual_start ? fmtTime(job.actual_start) : '—'}–{job.actual_end ? fmtTime(job.actual_end) : '—'}</>}</p>
      <div className="flex flex-wrap gap-2">
        {s === 'scheduled' && <button className={b} onClick={() => run('in_progress', { actual_start: new Date().toISOString() })}>Avvia ora</button>}
        {(s === 'scheduled' || s === 'in_progress') && <button className={b} onClick={() => setOpen(o => !o)}>Completa…</button>}
        {s !== 'completed' && s !== 'cancelled' && <button className={b + ' text-red-600'} onClick={() => confirm(`Annullare «${job.name}»?`) && run('cancelled')}>Annulla stampa</button>}
        {(s === 'completed' || s === 'cancelled') && <button className={b} onClick={() => run(job.planned_start ? 'scheduled' : 'to_schedule', { actual_end: null })}>Riapri</button>}
      </div>
      {open && (
        <div className="space-y-2 rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
          <p className="text-xs opacity-70">Orari effettivi facoltativi: lasciali vuoti se non vuoi registrarli.</p>
          <label className="block text-sm">Inizio effettivo<input type="datetime-local" className={inp} value={a} onChange={e => setA(e.target.value)} /></label>
          <label className="block text-sm">Fine effettiva<input type="datetime-local" className={inp} value={z} onChange={e => setZ(e.target.value)} /></label>
          {bad && <p role="alert" className="text-sm text-red-600">La fine deve essere dopo l'inizio.</p>}
          <button disabled={bad} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            onClick={() => run('completed', { actual_start: a ? fromInputValue(a, TZ).toISOString() : undefined, actual_end: z ? fromInputValue(z, TZ).toISOString() : undefined })}>Conferma completata</button>
        </div>
      )}
    </div>
  );
}
