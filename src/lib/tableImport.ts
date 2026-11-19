import type { Job } from '../hooks/useJobs';
import { PRIO, STAT, findDup, norm, type DraftRow } from './importer';
import { TZ_DEFAULT as TZ, fromInputValue, toInputValue } from './time';

export type Field = 'ignore' | 'id' | 'name' | 'pieces' | 'duration' | 'repetitions' | 'priority' | 'status' | 'start' | 'end' | 'actual_start' | 'actual_end' | 'optional' | 'notes';
export const FIELD_LABEL: Record<Field, string> = { ignore: '— ignora —', id: 'ID', name: 'Nome stampa', pieces: 'Pezzi per piatto', duration: 'Durata',
  repetitions: 'Ripetizioni', priority: 'Priorità', status: 'Stato', start: 'Inizio pianificato', end: 'Fine pianificata',
  actual_start: 'Inizio effettivo', actual_end: 'Fine effettiva', optional: 'Opzionale', notes: 'Note' };
export interface PdfItem { str: string; x: number; y: number; w: number }
export interface RawTable { kind: 'pdf' | 'csv'; labels: string[]; rows: string[][]; mapping: Field[]; year: number }

export function guessField(label: string): Field {
  const s = label.toLowerCase().trim();
  if (/effettiv/.test(s)) return /fine|termin/.test(s) ? 'actual_end' : 'actual_start';
  if (/^(id|codice|cod\.?|external_id)$/.test(s)) return 'id';
  if (/^(stampa|nome|nome stampa|lavorazione|modello|name)$/.test(s)) return 'name';
  if (/pezz|^pz|quantit/.test(s)) return 'pieces';
  if (/durata|duration/.test(s)) return 'duration';
  if (/ripetiz|^rip/.test(s)) return 'repetitions';
  if (/priorit/.test(s)) return 'priority';
  if (/^stato|status/.test(s)) return 'status';
  if (/inizio|start/.test(s)) return 'start';
  if (/^fine|^end/.test(s)) return 'end';
  if (/opzional|^opz/.test(s)) return 'optional';
  if (/^note/.test(s)) return 'notes';
  return 'ignore';
}
export function guessMapping(labels: string[]): Field[] {
  const used = new Set<Field>();
  return labels.map(l => { const f = guessField(l); if (f === 'ignore' || used.has(f)) return 'ignore'; used.add(f); return f; });
}

/** "5h 11m", "2h07", "45m", "02:50" o un numero semplice (minuti). 0 = non riconosciuta. */
export function parseDuration(s: string): number {
  const t = s.trim().toLowerCase(); if (!t) return 0;
  let m = t.match(/^(\d+)\s*h(?:\s*(\d+)\s*m?(?:in)?)?$/); if (m) return +m[1] * 60 + +(m[2] ?? 0);
  m = t.match(/^(\d+)\s*m(?:in)?$/); if (m) return +m[1];
  m = t.match(/^(\d+):(\d{2})$/); if (m) return +m[1] * 60 + +m[2];
  return /^\d+$/.test(t) ? +t : 0;
}
const p2 = (n: string | number) => String(n).padStart(2, '0');
/** '' = nessuna data; null = non riconosciuta; altrimenti 'yyyy-MM-ddTHH:mm' (ora di Roma). Senza anno si usa quello del documento. */
export function parseDate(s: string, year: number): string | null {
  const t = s.trim(); if (!t || /^[-–—]$/.test(t)) return '';
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(t)) { const d = new Date(t); return isNaN(d.getTime()) ? null : toInputValue(d, TZ); }
  let y: number, mo: number, d: number, h: number, mi: number;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  else {
    m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/); if (!m) return null;
    [y, mo, d, h, mi] = [m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year, +m[2], +m[1], +m[4], +m[5]];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}`;
}

// ---- PDF: da elementi di testo (con coordinate) a tabella grezza ----
function groupLines(items: PdfItem[]): PdfItem[][] {
  const sorted = items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const it of sorted) { const last = lines[lines.length - 1]; if (last && Math.abs(last[0].y - it.y) <= 3) last.push(it); else lines.push([it]); }
  return lines.map(l => l.sort((a, b) => a.x - b.x));
}
function cells(line: PdfItem[]) {
  const out: { text: string; x: number; end: number }[] = [];
  for (const it of line) {
    const c = out[out.length - 1];
    if (c && it.x - c.end < 5) { c.text += ' ' + it.str.trim(); c.end = it.x + it.w; } else out.push({ text: it.str.trim(), x: it.x, end: it.x + it.w });
  }
  return out;
}
/** Più pagine: l'intestazione si cerca una volta, quelle ripetute si saltano, le colonne restano le stesse. */
export function buildTable(pages: PdfItem[][]): RawTable | null {
  const all = pages.flatMap(p => p.map(i => i.str)).join(' ');
  const ym = all.match(/\d{1,2}\s+[a-zàèéìòù]+\s+(20\d{2})/i) ?? all.match(/\b(20\d{2})\b/);
  const year = ym ? +ym[1] : new Date().getFullYear();
  let header: { text: string; x: number }[] | null = null; const rows: string[][] = [];
  const isHeader = (cs: { text: string }[]) => cs.filter(c => guessField(c.text) !== 'ignore').length >= 3;
  for (const page of pages) for (const line of groupLines(page)) {
    const cs = cells(line);
    if (!header) { if (isHeader(cs)) header = cs; continue; }
    if (isHeader(cs)) continue;
    const row = header.map(() => '');
    for (const it of line) { let col = 0; header.forEach((h, i) => { if (h.x <= it.x + 3) col = i; }); row[col] = `${row[col]} ${it.str.trim()}`.trim(); }
    rows.push(row);
  }
  if (!header) return null;
  const labels = header.map(h => h.text);
  return { kind: 'pdf', labels, rows, mapping: guessMapping(labels), year };
}

// ---- CSV ----
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, ''); const first = src.split(/\r?\n/, 1)[0] ?? '';
  const d = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
export function readCsvTable(text: string): { table?: RawTable; error?: string } {
  const all = parseCsv(text); if (all.length < 2) return { error: 'CSV vuoto o senza righe di dati.' };
  const labels = all[0].map(l => l.trim()); const mapping = guessMapping(labels);
  if (!mapping.includes('name')) return { error: 'Intestazione CSV non riconosciuta: manca la colonna del nome.' };
  return { table: { kind: 'csv', labels, rows: all.slice(1), mapping, year: new Date().getFullYear() } };
}

// ---- tabella + mappatura => righe da rivedere (stesso formato dell'import JSON) ----
export function tableToRows(t: RawTable, mapping: Field[], existing: Job[]): { rows: DraftRow[]; skipped: number } {
  const col = (f: Field) => mapping.indexOf(f);
  const cell = (r: string[], f: Field) => (col(f) < 0 ? '' : (r[col(f)] ?? '').trim());
  if (col('name') < 0) return { rows: [], skipped: 0 };
  const merged: string[][] = []; let skipped = 0;
  for (const r of t.rows) {
    const filled = r.filter(c => c.trim()).length; if (!filled) continue;
    if (t.kind === 'pdf') {
      if (merged.length && !cell(r, 'id') && filled <= 2) {   // riga di continuazione (es. "(opz.)" a capo nella cella dello stato)
        r.forEach((c, j) => { if (c.trim()) merged[merged.length - 1][j] = `${merged[merged.length - 1][j] ?? ''} ${c.trim()}`.trim(); });
        continue;
      }
      if (filled < 3) { skipped++; continue; }                 // testo che non è una riga di tabella (note a piè di pagina)
    }
    merged.push([...r]);
  }
  const rows = merged.map((r, n): DraftRow => {
    const errs: string[] = [];
    const name = cell(r, 'name'); if (!name) errs.push('nome mancante');
    const dRaw = cell(r, 'duration'); const duration = parseDuration(dRaw); if (!duration) errs.push(`durata non riconosciuta${dRaw ? ` («${dRaw}»)` : ''}`);
    const pRaw = cell(r, 'pieces'); const pieces = /^\d+/.test(pRaw) ? parseInt(pRaw, 10) : 0; if (!pieces) errs.push('pezzi per piatto mancanti');
    const rRaw = cell(r, 'repetitions'); const repetitions = rRaw ? parseInt(rRaw, 10) || 0 : 1; if (!repetitions) errs.push('ripetizioni non valide');
    const prRaw = cell(r, 'priority'); const priority = PRIO[norm(prRaw)]; if (!priority) errs.push(`priorità non riconosciuta${prRaw ? ` («${prRaw}»)` : ''}`);
    const stRaw = cell(r, 'status'); const status = STAT[norm(stRaw.replace(/\(.*?\)/g, ''))]; if (!status) errs.push(`stato non riconosciuto${stRaw ? ` («${stRaw}»)` : ''}`);
    const optional = /opz/i.test(stRaw) || /^(si|sì|true|1|x)$/i.test(cell(r, 'optional'));
    const dt = (f: Field) => { const raw = cell(r, f); const v = parseDate(raw, t.year); if (v === null) errs.push(`data non riconosciuta («${raw}»)`); return v ?? ''; };
    const start = dt('start'), end = dt('end'), aStart = dt('actual_start'), aEnd = dt('actual_end');
    const iso = (v: string) => (v ? fromInputValue(v, TZ).toISOString() : null);
    const ext = cell(r, 'id') || null; const dup = findDup(ext, existing);
    return { key: `p${n}`, include: errs.length === 0, external_id: ext, name, pieces, duration, repetitions: repetitions || 1,
      priority: priority ?? 'medium', status: status ?? 'to_schedule', start, actual_start: iso(aStart), actual_end: iso(aEnd), declared_end: iso(end),
      optional, divisible: null, notes: cell(r, 'notes'), action: dup ? 'ignore' : 'insert', dupId: dup?.id ?? null,
      parseError: errs.length ? errs.join('; ') : null };
  });
  return { rows, skipped };
}
