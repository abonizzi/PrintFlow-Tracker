import { useMemo, useState } from 'react';
import { Archive as ArchiveIcon, Copy, Pencil, Plus, Trash2, Search } from 'lucide-react';
import { useArchiveTemplate, useDeleteTemplate, useDuplicateTemplate, useJobsLite, useSaveTemplate, useTemplates } from '../hooks/useTemplates';
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, fmtDuration, type Priority, type Template, type TemplateDraft } from '../lib/types';

const empty: TemplateDraft = { name: '', description: '', pieces_per_plate: 1, duration_minutes: 60, repetitions: 1,
  priority: 'medium', color: '#3b82f6', notes: '', divisible: false, preview_url: null };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900';

export function Archive() {
  const { data: templates = [], isLoading, error } = useTemplates();
  const { data: jobs = [] } = useJobsLite();
  const archive = useArchiveTemplate(); const del = useDeleteTemplate(); const dup = useDuplicateTemplate();
  const [q, setQ] = useState(''); const [prio, setPrio] = useState<Priority | ''>('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const fail = (e: Error) => alert(e.message);

  const rows = useMemo(() => templates
    .filter(t => !!t.archived_at === showArchived && t.name.toLowerCase().includes(q.toLowerCase()) && (!prio || t.priority === prio))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.name.localeCompare(b.name)),
    [templates, q, prio, showArchived]);
  const remaining = (id: string) => jobs.filter(j => j.template_id === id && j.status === 'to_schedule').length;

  return (
    <section className="mx-auto max-w-3xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 opacity-50" />
          <input aria-label="Cerca per nome" className={field + ' pl-9'} placeholder="Cerca…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select aria-label="Filtra per priorità" className={field + ' w-auto'} value={prio} onChange={e => setPrio(e.target.value as Priority | '')}>
          <option value="">Tutte le priorità</option>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Archiviati</label>
        <button onClick={() => setEditing('new')} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-white dark:bg-slate-100 dark:text-slate-900"><Plus className="h-4 w-4" />Nuova stampa</button>
      </div>
      {isLoading && <p>Caricamento…</p>}
      {error && <p role="alert" className="text-red-600">{(error as Error).message}</p>}
      {!isLoading && rows.length === 0 && <p className="py-8 text-center opacity-60">Nessun modello. Crea una stampa o importa un file.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map(t => (
          <li key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900" style={{ borderLeft: `6px solid ${t.color}` }}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.name}</p>
              <p className="text-sm opacity-70">{fmtDuration(t.duration_minutes)} · {t.pieces_per_plate} pz/piatto · da programmare: {remaining(t.id)}/{t.repetitions}</p>
              <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs text-white" style={{ background: PRIORITY_COLOR[t.priority] }}>{PRIORITY_LABEL[t.priority]}</span>
            </div>
            <button aria-label="Modifica" onClick={() => setEditing(t)} className="p-2"><Pencil className="h-4 w-4" /></button>
            <button aria-label="Duplica" onClick={() => dup(t).catch(fail)} className="p-2"><Copy className="h-4 w-4" /></button>
            <button aria-label={t.archived_at ? 'Ripristina' : 'Archivia'} onClick={() => archive.mutate(t, { onError: fail })} className="p-2"><ArchiveIcon className="h-4 w-4" /></button>
            <button aria-label="Elimina" onClick={() => confirm(`Eliminare "${t.name}"? Le lavorazioni da programmare vengono rimosse; quelle programmate o completate restano nello storico.`) && del.mutate(t.id, { onError: fail })} className="p-2 text-red-600"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      {editing && <TemplateDialog initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function TemplateDialog({ initial, onClose }: { initial: Template | null; onClose: () => void }) {
  const save = useSaveTemplate();
  const [d, setD] = useState<TemplateDraft>(initial ? { ...initial } : empty);
  const [h, setH] = useState(Math.floor(d.duration_minutes / 60)); const [m, setM] = useState(d.duration_minutes % 60);
  const minutes = h * 60 + m;
  const valid = d.name.trim() !== '' && minutes > 0 && d.pieces_per_plate > 0 && d.repetitions > 0;
  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) => setD(p => ({ ...p, [k]: v }));
  const num = (v: string) => Math.max(0, parseInt(v || '0', 10));
  return (
    <div role="dialog" aria-modal="true" aria-label="Modello di stampa" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <form className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-slate-900 sm:rounded-2xl"
        onSubmit={e => { e.preventDefault(); save.mutate({ id: initial?.id, version: initial?.version, draft: { ...d, name: d.name.trim(), duration_minutes: minutes } }, { onSuccess: onClose, onError: er => alert((er as Error).message) }); }}>
        <h2 className="text-lg font-semibold">{initial ? 'Modifica stampa' : 'Nuova stampa'}</h2>
        <label className="block text-sm">Nome<input required className={field} value={d.name} onChange={e => set('name', e.target.value)} /></label>
        <label className="block text-sm">Descrizione<input className={field} value={d.description ?? ''} onChange={e => set('description', e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Ore<input type="number" min={0} className={field} value={h} onChange={e => setH(num(e.target.value))} /></label>
          <label className="text-sm">Minuti<input type="number" min={0} max={59} className={field} value={m} onChange={e => setM(Math.min(59, num(e.target.value)))} /></label>
          <label className="text-sm">Pezzi per piatto<input type="number" min={1} className={field} value={d.pieces_per_plate} onChange={e => set('pieces_per_plate', num(e.target.value))} /></label>
          <label className="text-sm">Ripetizioni<input type="number" min={1} className={field} value={d.repetitions} onChange={e => set('repetitions', num(e.target.value))} /></label>
          <label className="text-sm">Priorità<select className={field} value={d.priority} onChange={e => set('priority', e.target.value as Priority)}>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="text-sm">Colore<input type="color" className={field + ' h-10 p-1'} value={d.color} onChange={e => set('color', e.target.value)} /></label>
        </div>
        <label className="block text-sm">Note<textarea className={field} rows={2} value={d.notes ?? ''} onChange={e => set('notes', e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.divisible} onChange={e => set('divisible', e.target.checked)} />Divisibile</label>
        {initial && d.repetitions < initial.repetitions && <p className="text-sm text-amber-600">Ridurre le ripetizioni non elimina le lavorazioni esistenti: rimuovile dall'archivio lavorazioni.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2">Annulla</button>
          <button disabled={!valid || save.isPending} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Salva</button>
        </div>
      </form>
    </div>
  );
}
