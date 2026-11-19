import { useMemo, useState, type DragEvent } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { useImportJobs } from '../hooks/useImport';
import { useJobs } from '../hooks/useJobs';
import { buildPayload, parseImportJson, validateRows, type DraftRow } from '../lib/importer';
import { FIELD_LABEL, readCsvTable, tableToRows, type Field, type RawTable } from '../lib/tableImport';
import { readPdfTable } from '../lib/pdfText';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type JobStatus, type Priority } from '../lib/types';

const inp = 'w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-700';
const STATUSES = Object.keys(STATUS_LABEL) as JobStatus[];

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const { data: existing = [] } = useJobs(); const { data: av } = useAvailability(); const imp = useImportJobs();
  const gap = av?.settings?.changeover_minutes ?? 15;
  const [step, setStep] = useState<'pick' | 'map' | 'review' | 'done'>('pick');
  const [table, setTable] = useState<RawTable | null>(null); const [mapping, setMapping] = useState<Field[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]); const [fileName, setFileName] = useState('');
  const [fileErr, setFileErr] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; updated: number; skipped: number; demoted: number } | null>(null);
  const drafted = useMemo(() => (table ? tableToRows(table, mapping, existing) : { rows: [] as DraftRow[], skipped: 0 }), [table, mapping, existing]);
  const checks = useMemo(() => validateRows(rows, existing, gap), [rows, existing, gap]);
  const patch = (key: string, p: Partial<DraftRow>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));

  async function onFile(f: File) {
    setFileErr([]); setBusy(true);
    try {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.pdf') || lower.endsWith('.csv')) {
        const res = lower.endsWith('.pdf') ? await readPdfTable(await f.arrayBuffer()) : readCsvTable(await f.text());
        if (res.error || !res.table) { setFileErr([res.error ?? 'File non leggibile']); return; }
        setTable(res.table); setMapping(res.table.mapping); setFileName(f.name); setStep('map'); return;
      }
      const r = parseImportJson(await f.text(), existing);
      if (r.errors.length) { setFileErr(r.errors); return; }
      setRows(r.rows); setFileName(f.name); setStep('review');
    } catch (e) { setFileErr([(e as Error).message]); } finally { setBusy(false); }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); };

  const sel = rows.filter(r => r.include && r.action !== 'ignore');
  const blocked = sel.filter(r => checks.get(r.key)!.errors.length).length;
  const payload = useMemo(() => buildPayload(rows, checks, fileName), [rows, checks, fileName]);
  const stat = {
    news: sel.filter(r => r.action === 'insert' || r.action === 'new').length, upd: sel.filter(r => r.action === 'update').length,
    dups: rows.filter(r => r.dupId).length, invalid: rows.filter(r => r.parseError).length,
    demoted: sel.filter(r => checks.get(r.key)!.demote).length };

  return (
    <div role="dialog" aria-modal="true" aria-label="Importa stampe" className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Importa stampe</h2>
          <button className="rounded-lg px-3 py-1.5 underline" onClick={onClose}>{step === 'done' ? 'Chiudi' : 'Annulla'}</button></div>

        {step === 'pick' && <>
          <label onDragOver={e => e.preventDefault()} onDrop={onDrop} className="flex h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-400 text-center">
            <span className="font-medium">{busy ? 'Elaborazione…' : 'Trascina qui il file o tocca per sceglierlo'}</span><span className="text-sm opacity-70">JSON (printflow-import v1), PDF digitale o CSV</span>
            <input type="file" accept=".json,application/json,.pdf,.csv,text/csv" className="sr-only" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
          {fileErr.map(e => <p key={e} role="alert" className="text-sm text-red-600">{e}</p>)}
          <p className="text-sm opacity-70">Nulla viene salvato prima della tua conferma finale.</p></>}

        {step === 'map' && table && <>
          <p className="text-sm">File: <b>{fileName}</b>. Controlla a quale campo corrisponde ogni colonna riconosciuta.</p>
          <ul className="space-y-2">{table.labels.map((l, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm dark:border-slate-800 dark:bg-slate-900">
              <span className="flex-1 truncate font-medium">{l || `Colonna ${i + 1}`}</span>
              <select aria-label={`Campo per ${l}`} className={inp + ' w-48'} value={mapping[i]} onChange={e => setMapping(m => m.map((f, j) => (j === i ? (e.target.value as Field) : f)))}>
                {(Object.keys(FIELD_LABEL) as Field[]).map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}</select></li>))}</ul>
          <p className="text-sm">{drafted.rows.length} righe riconosciute{drafted.skipped ? ` · ${drafted.skipped} righe di testo non tabellari ignorate` : ''}. Valori illeggibili non vengono inventati: li completi al passaggio successivo.</p>
          {!mapping.includes('name') && <p role="alert" className="text-sm text-red-600">Associa almeno la colonna del nome.</p>}
          <div className="flex justify-between"><button className="underline" onClick={() => setStep('pick')}>Indietro</button>
            <button disabled={!drafted.rows.length} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
              onClick={() => { setRows(drafted.rows); setStep('review'); }}>Continua</button></div></>}

        {step === 'review' && <>
          <p className="text-sm">File: <b>{fileName}</b> · {rows.length} record · {stat.news} nuove · {stat.upd} da aggiornare · {stat.dups} già presenti · {stat.invalid} non valide · {stat.demoted} in conflitto (importate come «Da programmare»)</p>
          <ul className="space-y-2">{rows.map(r => {
            const c = checks.get(r.key)!; const off = !r.include || r.action === 'ignore'; const bad = r.include && c.errors.length > 0;
            return (
              <li key={r.key} className={`rounded-xl border p-2 text-sm ${bad ? 'border-red-400' : 'border-slate-200 dark:border-slate-800'} ${off ? 'opacity-60' : ''} bg-white dark:bg-slate-900`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" aria-label="Includi" className="h-5 w-5" checked={r.include} onChange={e => patch(r.key, { include: e.target.checked })} />
                  <input aria-label="Nome" className={inp} value={r.name} onChange={e => patch(r.key, { name: e.target.value })} />
                  <span className="shrink-0 text-xs opacity-60">{r.external_id ?? 'senza ID'}</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label>Pezzi<input type="number" min={1} className={inp} value={r.pieces} onChange={e => patch(r.key, { pieces: +e.target.value })} /></label>
                  <label>Durata (min)<input type="number" min={1} className={inp} value={r.duration} onChange={e => patch(r.key, { duration: +e.target.value })} /></label>
                  <label>Ripetizioni<input type="number" min={1} className={inp} value={r.repetitions} onChange={e => patch(r.key, { repetitions: +e.target.value })} /></label>
                  <label>Priorità<select className={inp} value={r.priority} onChange={e => patch(r.key, { priority: e.target.value as Priority })}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
                  <label>Stato<select className={inp} value={r.status} onChange={e => patch(r.key, { status: e.target.value as JobStatus })}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
                  <label className="col-span-2">Inizio (Europe/Rome)<input type="datetime-local" className={inp} value={r.start} onChange={e => patch(r.key, { start: e.target.value })} /></label>
                  <label className="flex items-end gap-1"><input type="checkbox" className="mb-2 h-5 w-5" checked={r.optional} onChange={e => patch(r.key, { optional: e.target.checked })} />Opzionale</label>
                  {r.dupId && <label className="col-span-2 sm:col-span-4">Già presente — cosa fare?
                    <select className={inp} value={r.action} onChange={e => patch(r.key, { action: e.target.value as DraftRow['action'], include: true })}>
                      <option value="ignore">Ignora</option><option value="update">Aggiorna il record esistente</option><option value="new">Importa come nuova lavorazione</option></select></label>}
                </div>
                {r.parseError && <p className="mt-1 text-red-600">Record non valido nel file: {r.parseError}. Correggi i campi e includilo.</p>}
                {r.include && c.errors.map(e => <p key={e} role="alert" className="mt-1 text-red-600">✗ {e}</p>)}
                {r.include && c.warnings.map(e => <p key={e} className="mt-1 text-amber-600">⚠ {e}</p>)}
                {r.include && c.demote && <p className="mt-1 text-amber-600">⚠ {c.conflict}: sarà importata come «Da programmare» e l'orario originale resterà nei metadati.</p>}
              </li>);
          })}</ul>
          {imp.error && <p role="alert" className="text-sm text-red-600">{(imp.error as Error).message}</p>}
          <div className="sticky bottom-0 flex items-center justify-between gap-2 bg-slate-50 py-2 dark:bg-slate-950">
            <span className="text-sm">{blocked ? `${blocked} record con errori: correggili o deselezionali` : `${payload.rows.length} lavorazioni da salvare`}</span>
            <button disabled={blocked > 0 || payload.rows.length === 0 || imp.isPending} className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-40"
              onClick={() => imp.mutate({ rows: payload.rows, batch: { filename: fileName, skipped: payload.skipped, demoted: payload.demoted } },
                { onSuccess: d => { setResult({ ...d, skipped: payload.skipped, demoted: payload.demoted }); setStep('done'); } })}>
              {imp.isPending ? 'Importazione…' : 'Importa'}</button></div></>}

        {step === 'done' && result && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="font-semibold">Importazione completata</p>
          <p>{result.inserted} nuove lavorazioni · {result.updated} aggiornate · {result.skipped} ignorate · {result.demoted} importate come «Da programmare» per conflitto.</p>
          <p className="text-sm">Archivio, timeline e dashboard sono già aggiornati.</p></div>}
      </div>
    </div>
  );
}
