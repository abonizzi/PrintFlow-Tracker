import { z } from 'zod';
import type { Job } from '../hooks/useJobs';
import { MIN, TZ_DEFAULT as TZ, computeEnd, fmtTime, fromInputValue, toInputValue } from './time';
import { PRIORITY_COLOR, type JobStatus, type Priority } from './types';

/** Origine comune a PDF e JSON: lo stesso external_id (PF-xxx) è riconosciuto qualunque sia il formato. */
export const IMPORT_SOURCE = 'printflow-export';
export const PRIO: Record<string, Priority> = { massima: 'max', alta: 'high', media: 'medium', bassa: 'low', max: 'max', high: 'high', medium: 'medium', low: 'low' };
export const STAT: Record<string, JobStatus> = { da_programmare: 'to_schedule', programmata: 'scheduled', in_corso: 'in_progress', completata: 'completed', annullata: 'cancelled',
  to_schedule: 'to_schedule', scheduled: 'scheduled', in_progress: 'in_progress', completed: 'completed', cancelled: 'cancelled' };
export const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const prio = z.string().transform(norm).refine(v => v in PRIO, 'valore non riconosciuto').transform(v => PRIO[v]);
const stat = z.string().transform(norm).refine(v => v in STAT, 'valore non riconosciuto').transform(v => STAT[v]);
const dt = z.string().datetime({ offset: true }).nullish();

export const headerSchema = z.object({
  schema: z.literal('printflow-import'), schema_version: z.literal(1),
  timezone: z.string().default('Europe/Rome'), printer_count: z.number().int().positive().default(1),
  changeover_minutes: z.number().int().min(0).max(240).default(15), jobs: z.array(z.unknown()),
});
export const jobSchema = z.object({
  external_id: z.string().nullish(), name: z.string().trim().min(1, 'nome mancante'),
  quantity_per_plate: z.number().int().positive(), duration_minutes: z.number().int().positive(),
  repetitions: z.number().int().min(1).default(1), priority: prio, status: stat,
  planned_start: dt, planned_end: dt, actual_start: dt, actual_end: dt,
  optional: z.boolean().default(false), divisible: z.boolean().nullish(), notes: z.string().nullish(),
});

export interface DraftRow {
  key: string; include: boolean; external_id: string | null; name: string; pieces: number; duration: number; repetitions: number;
  priority: Priority; status: JobStatus; start: string; actual_start: string | null; actual_end: string | null; declared_end: string | null;
  optional: boolean; divisible: boolean | null; notes: string;
  action: 'insert' | 'ignore' | 'update' | 'new'; dupId: string | null; parseError: string | null;
}
export interface RowCheck { errors: string[]; warnings: string[]; demote: boolean; conflict?: string }
export interface ParseResult { rows: DraftRow[]; errors: string[]; header: z.infer<typeof headerSchema> | null }

export const findDup = (ext: string | null, existing: Job[]) => !ext ? undefined :
  existing.find(j => (j.import_source === IMPORT_SOURCE && j.external_id === ext) || (ext.startsWith('PFX-') && ext.length >= 12 && j.id.startsWith(ext.slice(4))));
const iso2local = (v: unknown) => { if (typeof v !== 'string') return ''; const d = new Date(v); return isNaN(d.getTime()) ? '' : toInputValue(d, TZ); };
const parse = (s: string): Date | null | undefined => { if (!s) return null; const d = fromInputValue(s, TZ); return isNaN(d.getTime()) ? undefined : d; };

function toRow(raw: unknown, i: number, existing: Job[]): DraftRow {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ext = typeof o.external_id === 'string' && o.external_id ? o.external_id : null;
  const dup = findDup(ext, existing);
  const base = { key: `r${i}`, external_id: ext, dupId: dup?.id ?? null, action: (dup ? 'ignore' : 'insert') as DraftRow['action'] };
  const p = jobSchema.safeParse(raw);
  if (p.success) {
    const d = p.data;
    return { ...base, include: true, name: d.name, pieces: d.quantity_per_plate, duration: d.duration_minutes, repetitions: d.repetitions,
      priority: d.priority, status: d.status, start: iso2local(d.planned_start), actual_start: d.actual_start ?? null, actual_end: d.actual_end ?? null,
      declared_end: d.planned_end ?? null, optional: d.optional, divisible: d.divisible ?? null, notes: d.notes ?? '', parseError: null };
  }
  // record non valido: resta visibile e correggibile, ma disattivato finché non lo includi tu
  return { ...base, include: false, name: String(o.name ?? ''), pieces: Number(o.quantity_per_plate) || 0, duration: Number(o.duration_minutes) || 0,
    repetitions: Number(o.repetitions) || 1, priority: PRIO[norm(o.priority)] ?? 'medium', status: STAT[norm(o.status)] ?? 'to_schedule',
    start: iso2local(o.planned_start), actual_start: null, actual_end: null, declared_end: typeof o.planned_end === 'string' ? o.planned_end : null,
    optional: o.optional === true, divisible: null, notes: String(o.notes ?? ''),
    parseError: p.error.issues.map(x => `${x.path.join('.') || 'record'}: ${x.message}`).join('; ') };
}

export function parseImportJson(text: string, existing: Job[]): ParseResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { rows: [], errors: ['Il file non è un JSON valido.'], header: null }; }
  const h = headerSchema.safeParse(data);
  if (!h.success) return { rows: [], errors: ['Formato non riconosciuto: servono schema "printflow-import" e schema_version 1.'], header: null };
  return { rows: h.data.jobs.map((raw, i) => toRow(raw, i, existing)), errors: [], header: h.data };
}

/** Controlli sul calendario: durate, date, coerenza fine, sovrapposizioni e cambio piatto (anche verso le lavorazioni già presenti). */
export function validateRows(rows: DraftRow[], existing: Job[], gapMin: number): Map<string, RowCheck> {
  const out = new Map<string, RowCheck>(); const gap = gapMin * MIN;
  const updating = new Set(rows.filter(r => r.include && r.action === 'update' && r.dupId).map(r => r.dupId));
  const occ = existing.filter(j => j.status !== 'cancelled' && j.planned_start && j.planned_end && !updating.has(j.id))
    .map(j => ({ s: +new Date(j.planned_start!), e: +new Date(j.planned_end!), name: j.name }));
  const timed: { r: DraftRow; s: Date }[] = [];
  for (const r of rows) {
    const c: RowCheck = { errors: [], warnings: [], demote: false }; out.set(r.key, c);
    if (!r.name.trim()) c.errors.push('Nome mancante');
    if (!(Number.isInteger(r.duration) && r.duration > 0)) c.errors.push('Durata non valida (minuti interi > 0)');
    if (!(Number.isInteger(r.pieces) && r.pieces > 0)) c.errors.push('Pezzi per piatto non validi');
    if (!(Number.isInteger(r.repetitions) && r.repetitions >= 1)) c.errors.push('Ripetizioni non valide');
    const s = parse(r.start);
    if (s === undefined) c.errors.push('Data di inizio non valida');
    if ((r.status === 'scheduled' || r.status === 'in_progress') && !s) c.errors.push('Inizio mancante per una stampa programmata o in corso');
    if (r.status === 'to_schedule' && s) c.warnings.push("L'orario sarà ignorato: lo stato è Da programmare");
    if (s && r.duration > 0) {
      const calc = computeEnd(s, r.duration);
      if (r.declared_end) {
        const d = new Date(r.declared_end);
        if (!isNaN(d.getTime()) && d.getTime() !== calc.getTime())
          c.warnings.push(`Fine indicata ${fmtTime(d, TZ, 'dd/MM HH:mm')} diversa da inizio + durata: verrà usata ${fmtTime(calc, TZ, 'dd/MM HH:mm')}`);
      }
      if (r.include && r.action !== 'ignore' && !c.errors.length && r.status !== 'cancelled' && r.status !== 'to_schedule') timed.push({ r, s });
    }
  }
  timed.sort((a, b) => +a.s - +b.s);
  for (const { r, s } of timed) {
    const st = +s, en = +computeEnd(s, r.duration);
    const o = occ.find(x => st < x.e + gap && en + gap > x.s);
    if (o) { const c = out.get(r.key)!; c.demote = true;
      c.conflict = `${st < o.e && en > o.s ? 'Si sovrappone a' : 'Intervallo di cambio piatto non rispettato con'} «${o.name}»`; }
    else occ.push({ s: st, e: en, name: r.name });
  }
  return out;
}

/** Record da inviare alla funzione transazionale. I conflitti diventano "Da programmare" con l'orario originale nei metadati. */
export function buildPayload(rows: DraftRow[], checks: Map<string, RowCheck>, fileName: string) {
  const out: Record<string, unknown>[] = []; let demoted = 0, skipped = 0;
  for (const r of rows) {
    const c = checks.get(r.key)!;
    if (!r.include || r.action === 'ignore') { skipped++; continue; }
    if (c.errors.length) continue;
    const s = parse(r.start) ?? null; const end = s ? computeEnd(s, r.duration) : null;
    let status = r.status; let start: Date | null = r.status === 'to_schedule' ? null : s;
    const meta: Record<string, unknown> = { source_file: fileName, original_external_id: r.external_id };
    if (r.declared_end) meta.declared_end = r.declared_end;
    if (c.demote) {
      demoted++; start = null; meta.original_planned_start = s?.toISOString(); meta.original_planned_end = end?.toISOString(); meta.demoted_reason = c.conflict;
      if (status === 'scheduled' || status === 'in_progress') status = 'to_schedule';
    }
    const rec = { action: r.action === 'update' ? 'update' : 'insert', id: r.action === 'update' ? r.dupId : null,
      external_id: r.action === 'new' ? null : r.external_id, name: r.name.trim(), pieces_per_plate: r.pieces, duration_minutes: r.duration,
      priority: r.priority, status, planned_start: start?.toISOString() ?? null, actual_start: r.actual_start, actual_end: r.actual_end,
      optional: r.optional, divisible: r.divisible, notes: r.notes || null, color: PRIORITY_COLOR[r.priority], import_meta: meta };
    out.push(rec);
    if (r.action !== 'update') for (let n = 2; n <= r.repetitions; n++)   // ripetizioni = record distinti, da programmare
      out.push({ ...rec, external_id: rec.external_id ? `${rec.external_id}#${n}` : null, status: 'to_schedule', planned_start: null,
        actual_start: null, actual_end: null, import_meta: { ...meta, repetition: n } });
  }
  return { rows: out, demoted, skipped };
}
