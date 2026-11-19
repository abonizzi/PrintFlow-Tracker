import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAvailability, useDeleteException, useSaveException, useUpdateRule, useUpdateSettings } from '../hooks/useAvailability';
import { hm, type Exc } from '../lib/availability';

const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const inp = 'rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-700';
const fail = (e: Error) => alert(e.message);

function TimeInput({ label, value, required, onSave }: { label: string; value: string | null; required?: boolean; onSave: (v: string | null) => void }) {
  const cur = hm(value) ?? '';
  return <input type="time" aria-label={label} className={inp + ' w-28'} key={cur} defaultValue={cur}
    onBlur={e => { const v = e.target.value; if (v === cur || (required && !v)) return; onSave(v || null); }} />;
}

export function Settings() {
  const { data, isLoading, error } = useAvailability();
  const upRule = useUpdateRule(), upSet = useUpdateSettings(), saveEx = useSaveException(), delEx = useDeleteException();
  const [ex, setEx] = useState({ on_date: '', kind: 'holiday' as Exc['kind'], wake: '', leave: '', ret: '', last: '', note: '' });
  if (isLoading) return <p className="p-4">Caricamento…</p>;
  if (error || !data) return <p role="alert" className="p-4 text-red-600">{(error as Error)?.message ?? 'Errore'}</p>;
  const { rules, exceptions, settings } = data;
  const n = (v: string) => v || null;
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-4">
      {(!settings || rules.length === 0) && <p role="alert" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">Impostazioni iniziali mancanti: esegui la migrazione 0005_backfill_defaults.sql su Supabase e ricarica.</p>}
      <div>
        <h2 className="mb-2 font-semibold">Disponibilità settimanale</h2>
        <p className="mb-2 text-sm opacity-70">Lascia vuoti uscita e rientro se resti a casa. Gli avvisi non impediscono mai di programmare: chiedono conferma.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left opacity-70"><th>Giorno</th><th>Risveglio</th><th>Uscita</th><th>Rientro</th><th>Ultimo avvio sera</th></tr></thead>
          <tbody>{rules.map(r => (
            <tr key={r.id}><td className="py-1 pr-2">{DAYS[r.weekday]}</td>
              <td><TimeInput label={`Risveglio ${DAYS[r.weekday]}`} required value={r.wake_time} onSave={v => upRule.mutate({ id: r.id, patch: { wake_time: v! } }, { onError: fail })} /></td>
              <td><TimeInput label={`Uscita ${DAYS[r.weekday]}`} value={r.leave_time} onSave={v => upRule.mutate({ id: r.id, patch: { leave_time: v } }, { onError: fail })} /></td>
              <td><TimeInput label={`Rientro ${DAYS[r.weekday]}`} value={r.return_time} onSave={v => upRule.mutate({ id: r.id, patch: { return_time: v } }, { onError: fail })} /></td>
              <td><TimeInput label={`Ultimo avvio ${DAYS[r.weekday]}`} required value={r.last_evening_start} onSave={v => upRule.mutate({ id: r.id, patch: { last_evening_start: v! } }, { onError: fail })} /></td></tr>))}
          </tbody></table></div>
      </div>
      {settings && <div className="flex flex-wrap gap-4">
        <label className="text-sm">Intervallo minimo tra stampe (min)<input type="number" min={0} max={240} className={inp + ' mt-1 block w-28'} key={settings.changeover_minutes} defaultValue={settings.changeover_minutes}
          onBlur={e => { const v = Math.min(240, Math.max(0, parseInt(e.target.value || '0', 10))); if (v !== settings.changeover_minutes) upSet.mutate({ changeover_minutes: v }, { onError: fail }); }} /></label>
        <label className="text-sm">Snap predefinito<select className={inp + ' mt-1 block'} value={settings.snap_minutes} onChange={e => upSet.mutate({ snap_minutes: +e.target.value }, { onError: fail })}>
          {[1, 5, 10, 15].map(s => <option key={s} value={s}>{s === 1 ? 'Al minuto' : `${s} minuti`}</option>)}</select></label>
      </div>}
      <div>
        <h2 className="mb-2 font-semibold">Giorni festivi ed eccezioni</h2>
        <form className="mb-3 flex flex-wrap items-end gap-2 text-sm" onSubmit={e => { e.preventDefault(); if (!ex.on_date) return;
          saveEx.mutate({ on_date: ex.on_date, kind: ex.kind, wake_time: n(ex.wake), leave_time: n(ex.leave), return_time: n(ex.ret), last_evening_start: n(ex.last), note: n(ex.note) },
            { onSuccess: () => setEx(s => ({ ...s, on_date: '', note: '' })), onError: fail }); }}>
          <label>Data<input type="date" required className={inp + ' block'} value={ex.on_date} onChange={e => setEx({ ...ex, on_date: e.target.value })} /></label>
          <label>Tipo<select className={inp + ' block'} value={ex.kind} onChange={e => setEx({ ...ex, kind: e.target.value as Exc['kind'] })}>
            <option value="holiday">Festivo (a casa tutto il giorno)</option><option value="custom">Orari personalizzati</option></select></label>
          {([['wake', 'Risveglio'], ['leave', 'Uscita'], ['ret', 'Rientro'], ['last', 'Ultimo avvio']] as const).map(([k, l]) =>
            <label key={k}>{l}<input type="time" className={inp + ' block w-28'} value={ex[k]} onChange={e => setEx({ ...ex, [k]: e.target.value })} /></label>)}
          <label>Nota<input className={inp + ' block'} value={ex.note} onChange={e => setEx({ ...ex, note: e.target.value })} /></label>
          <button className="rounded-lg bg-slate-900 px-3 py-2 text-white dark:bg-slate-100 dark:text-slate-900">Aggiungi</button>
        </form>
        <p className="mb-2 text-xs opacity-70">Orari vuoti = valori abituali del giorno.</p>
        <ul className="space-y-1 text-sm">{exceptions.map(x => (
          <li key={x.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-800">
            <span className="font-medium">{x.on_date}</span><span>{x.kind === 'holiday' ? 'Festivo' : 'Personalizzato'}</span>
            <span className="flex-1 truncate opacity-70">{x.note}</span>
            <button aria-label="Elimina eccezione" onClick={() => delEx.mutate(x.id, { onError: fail })}><Trash2 className="h-4 w-4 text-red-600" /></button></li>))}
          {exceptions.length === 0 && <li className="opacity-60">Nessuna eccezione.</li>}</ul>
      </div>
    </section>
  );
}
