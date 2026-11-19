import { describe, expect, it } from 'vitest';
import type { Job } from '../hooks/useJobs';
import { exportJson } from './exporters';
import { IMPORT_SOURCE, buildPayload, parseImportJson, validateRows } from './importer';
import { computeEnd } from './time';

const file = (jobs: unknown[]) => JSON.stringify({ schema: 'printflow-import', schema_version: 1, timezone: 'Europe/Rome', printer_count: 1, changeover_minutes: 15, jobs });
const J = (o: Record<string, unknown>) => ({ external_id: 'PF-X', name: 'Test', quantity_per_plate: 1, duration_minutes: 60, repetitions: 1,
  priority: 'media', status: 'programmata', planned_start: null, planned_end: null, optional: false, divisible: null, notes: '', ...o });
const PF1 = J({ external_id: 'PF-001', name: 'Renne', quantity_per_plate: 2, duration_minutes: 311, priority: 'alta', status: 'completata' });
const PF4 = J({ external_id: 'PF-004', name: 'Bianco Babbo Natale', duration_minutes: 366, planned_start: '2026-11-17T21:22:00+01:00', planned_end: '2026-11-18T03:28:00+01:00' });
const run = (jobs: unknown[], existing: Job[] = []) => { const p = parseImportJson(file(jobs), existing); const c = validateRows(p.rows, existing, 15); return { p, c, pay: buildPayload(p.rows, c, 'x.json') }; };
const mkJob = (o: Partial<Job>): Job => ({ id: 'id1', template_id: null, repetition_index: 1, name: 'Old', pieces_per_plate: 1, duration_minutes: 60, priority: 'medium',
  status: 'scheduled', optional: false, planned_start: null, planned_end: null, actual_start: null, actual_end: null, version: 1, notes: null, ...o });

describe('importazione JSON v1', () => {
  it('mappa priorità/stati italiani e orari con fuso', () => {
    const { p } = run([PF1, PF4]);
    expect([p.rows[0].priority, p.rows[0].status, p.rows[1].start]).toEqual(['high', 'completed', '2026-11-17T21:22']);
  });
  it('rifiuta file con schema o versione errati', () => {
    expect(parseImportJson('{"schema":"altro"}', []).errors.length).toBe(1);
    expect(parseImportJson('non json', []).errors.length).toBe(1);
  });
  it('record non validi restano visibili ma disattivati', () => {
    const { p } = run([J({ duration_minutes: 0, priority: 'urgente' })]);
    expect(p.rows[0].include).toBe(false); expect(p.rows[0].parseError).toBeTruthy();
  });
  it('segnala fine incoerente senza inventare dati', () => {
    const { c } = run([J({ planned_start: '2026-11-17T19:00:00+01:00', planned_end: '2026-11-17T22:00:00+01:00', duration_minutes: 127 })]);
    expect(c.get('r0')!.warnings[0]).toMatch(/verrà usata 17\/11 21:07/);
  });
  it('conflitto: importata come Da programmare con orario originale nei metadati', () => {
    const { pay } = run([PF4, J({ external_id: 'PF-Y', planned_start: '2026-11-17T21:30:00+01:00', planned_end: '2026-11-17T22:30:00+01:00' })]);
    const y = pay.rows[1] as Record<string, any>;
    expect([y.status, y.planned_start]).toEqual(['to_schedule', null]);
    expect(y.import_meta.original_planned_start).toBe('2026-11-17T20:30:00.000Z'); expect(pay.demoted).toBe(1);
  });
  it('rispetta il cambio piatto di 15 minuti (14 min non bastano, 15 sì)', () => {
    const a = J({ planned_start: '2026-11-17T19:00:00+01:00', duration_minutes: 127 });
    expect(run([a, J({ external_id: 'B', planned_start: '2026-11-17T21:21:00+01:00' })]).pay.demoted).toBe(1);
    expect(run([a, J({ external_id: 'B', planned_start: '2026-11-17T21:22:00+01:00' })]).pay.demoted).toBe(0);
  });
  it('duplicati: ignorati di default, aggiornabili, importabili come nuovi; reimport senza duplicare', () => {
    const ex = [mkJob({ external_id: 'PF-001', import_source: IMPORT_SOURCE })];
    const first = run([PF1], ex); expect(first.p.rows[0].action).toBe('ignore'); expect(first.pay.rows).toHaveLength(0);
    const p = parseImportJson(file([PF1]), ex); p.rows[0].action = 'update';
    expect(buildPayload(p.rows, validateRows(p.rows, ex, 15), 'x')).toMatchObject({ rows: [{ action: 'update', id: 'id1' }] });
    p.rows[0].action = 'new';
    expect(buildPayload(p.rows, validateRows(p.rows, ex, 15), 'x').rows[0]).toMatchObject({ action: 'insert', external_id: null });
  });
  it('ripetizioni: record distinti, solo il primo mantiene stato e orario', () => {
    const { pay } = run([PF4 && J({ external_id: 'PF-R', repetitions: 3, planned_start: '2026-11-18T05:00:00+01:00' })]);
    expect(pay.rows.map(r => r.external_id)).toEqual(['PF-R', 'PF-R#2', 'PF-R#3']);
    expect(pay.rows.map(r => r.status)).toEqual(['scheduled', 'to_schedule', 'to_schedule']);
  });
  it('stato completato mantenuto anche con data passata; programmata resta programmata', () => {
    const { pay } = run([PF1, J({ external_id: 'P', planned_start: '2020-01-01T10:00:00+01:00' })]);
    expect(pay.rows.map(r => r.status)).toEqual(['completed', 'scheduled']);
  });
  it('esporta e reimporta senza perdere informazioni', () => {
    const s = new Date('2026-11-17T20:22:00Z');
    const j = mkJob({ external_id: null, name: 'Notturna', duration_minutes: 366, planned_start: s.toISOString(), planned_end: computeEnd(s, 366).toISOString(), notes: 'n' });
    const r = parseImportJson(exportJson([j]), []).rows[0];
    expect([r.name, r.duration, r.start, r.status, r.notes, r.external_id]).toEqual(['Notturna', 366, '2026-11-17T21:22', 'scheduled', 'n', 'PFX-id1']);
  });
});
