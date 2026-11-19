import { formatInTimeZone } from 'date-fns-tz';
import type { Job } from '../hooks/useJobs';
import { TZ_DEFAULT as TZ } from './time';

const IT_PRIO = { max: 'massima', high: 'alta', medium: 'media', low: 'bassa' } as const;
const IT_STAT = { to_schedule: 'da_programmare', scheduled: 'programmata', in_progress: 'in_corso', completed: 'completata', cancelled: 'annullata' } as const;
const iso = (v: string | null) => (v ? formatInTimeZone(v, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX") : null);
const sorted = (jobs: Job[]) => [...jobs].sort((a, b) => (a.planned_start ?? '9').localeCompare(b.planned_start ?? '9') || a.name.localeCompare(b.name));

/** JSON nel formato printflow-import v1: si può reimportare senza perdere informazioni (anche inizio/fine effettivi). */
export function exportJson(jobs: Job[], changeoverMinutes = 15) {
  return JSON.stringify({ schema: 'printflow-import', schema_version: 1, export_date: new Date().toISOString().slice(0, 10), timezone: TZ,
    printer_count: 1, changeover_minutes: changeoverMinutes,
    jobs: sorted(jobs).map(j => ({ external_id: j.external_id ?? `PFX-${j.id}`, name: j.name, quantity_per_plate: j.pieces_per_plate,
      duration_minutes: j.duration_minutes, repetitions: 1, priority: IT_PRIO[j.priority], status: IT_STAT[j.status],
      planned_start: iso(j.planned_start), planned_end: iso(j.planned_end), actual_start: iso(j.actual_start), actual_end: iso(j.actual_end),
      optional: j.optional, divisible: null, notes: j.notes ?? '' })) }, null, 2);
}

const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function exportCsv(jobs: Job[]) {
  const head = ['external_id', 'nome', 'pezzi', 'durata_min', 'priorita', 'stato', 'inizio_pianificato', 'fine_pianificata', 'inizio_effettivo', 'fine_effettiva', 'opzionale', 'note'];
  const rows = sorted(jobs).map(j => [j.external_id ?? '', j.name, j.pieces_per_plate, j.duration_minutes, IT_PRIO[j.priority], IT_STAT[j.status],
    iso(j.planned_start), iso(j.planned_end), iso(j.actual_start), iso(j.actual_end), j.optional ? 'si' : 'no', j.notes].map(q).join(','));
  return '\ufeff' + [head.map(q).join(','), ...rows].join('\r\n');
}

export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click(); URL.revokeObjectURL(url);
}

/** Calendario leggibile (testo): una sezione per giorno, con indicazione delle stampe che finiscono il giorno dopo. */
export function exportCalendarText(jobs: Job[]) {
  const act = jobs.filter(j => j.planned_start && j.planned_end && j.status !== 'cancelled').sort((a, b) => a.planned_start!.localeCompare(b.planned_start!));
  const out = ['PRINTFLOW - Calendario stampe', `Fuso: ${TZ}`, ''];
  let day = '';
  for (const j of act) {
    const d = formatInTimeZone(j.planned_start!, TZ, 'yyyy-MM-dd');
    if (d !== day) { day = d; out.push('', format(parseISO(d), 'EEEE dd/MM/yyyy', { locale: it }).toUpperCase()); }
    const endDay = formatInTimeZone(j.planned_end!, TZ, 'yyyy-MM-dd');
    out.push(`  ${formatInTimeZone(j.planned_start!, TZ, 'HH:mm')}–${formatInTimeZone(j.planned_end!, TZ, 'HH:mm')}${endDay !== d ? ` (${formatInTimeZone(j.planned_end!, TZ, 'dd/MM')})` : ''}  ${j.name}  [${PRIORITY_LABEL[j.priority]}] ${STATUS_LABEL[j.status]}${j.optional ? ' (opz.)' : ''}`);
  }
  if (!act.length) out.push('Nessuna stampa programmata.');
  return out.join('\n') + '\n';
}
