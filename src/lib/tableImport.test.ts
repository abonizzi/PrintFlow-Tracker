import { describe, expect, it } from 'vitest';
import type { Job } from '../hooks/useJobs';
import { exportCsv } from './exporters';
import { buildTable, parseCsv, parseDate, parseDuration, readCsvTable, tableToRows, type PdfItem } from './tableImport';

const line = (y: number, cells: [number, string][]): PdfItem[] => cells.map(([x, str]) => ({ str, x, y, w: str.length * 4 }));
const X = { id: 20, name: 60, pcs: 250, dur: 290, pri: 335, st: 390, a: 470, b: 560 };
const header = (y: number) => [...line(y, [[X.id, 'ID'], [X.name, 'Stampa'], [X.pcs, 'Pezzi'], [X.dur, 'Durata'], [X.pri, 'Priorità'], [X.st, 'Stato']]),
  ...line(y, [[X.a, 'Inizio'], [498, 'pianificato'], [X.b, 'Fine'], [580, 'pianificata']])];
const row = (y: number, id: string, name: string, p: string, d: string, pr: string, st: string, a: string, b: string) =>
  line(y, [[X.id, id], [X.name, name], [X.pcs, p], [X.dur, d], [X.pri, pr], [X.st, st], [X.a, a], [X.b, b]]);
const page1 = [...line(780, [[20, 'PRINTFLOW | Archivio stampe 3D']]), ...line(765, [[20, 'Esportazione strutturata - 17 novembre 2026 | Fuso: Europe/Rome']]),
  ...header(740), ...row(720, 'PF-001', 'Renne', '2', '5h 11m', 'Alta', 'Completata', '-', '-'),
  ...row(705, 'PF-004', 'Bianco Babbo Natale', '5', '6h 06m', 'Media', 'Programmata', '17/11 21:22', '18/11 03:28')];
const page2 = [...header(780), ...row(760, 'PF-021', 'Sottobicchieri', '4', '2h 50m', 'Bassa', 'Da programmare', '-', '-'), ...line(751, [[X.st, '(opz.)']]),
  ...line(700, [[20, 'Per importazioni senza ambiguità, utilizzare il JSON allegato.']])];

describe('PDF a tabella', () => {
  const t = buildTable([page1, page2])!;
  it('riconosce intestazione, colonne e anno', () => {
    expect(t.labels).toEqual(['ID', 'Stampa', 'Pezzi', 'Durata', 'Priorità', 'Stato', 'Inizio pianificato', 'Fine pianificata']);
    expect(t.mapping).toEqual(['id', 'name', 'pieces', 'duration', 'priority', 'status', 'start', 'end']);
    expect(t.year).toBe(2026);
  });
  it('tabella su più pagine, intestazione ripetuta, cella a capo e testo a piè di pagina', () => {
    const { rows, skipped } = tableToRows(t, t.mapping, []);
    expect(rows.map(r => r.external_id)).toEqual(['PF-001', 'PF-004', 'PF-021']);
    expect(skipped).toBe(1);
    expect(rows.every(r => !r.parseError)).toBe(true);
    expect([rows[0].status, rows[0].start, rows[0].priority]).toEqual(['completed', '', 'high']);
    expect([rows[1].start, rows[1].duration, rows[1].declared_end]).toEqual(['2026-11-17T21:22', 366, '2026-11-18T02:28:00.000Z']);
    expect([rows[2].status, rows[2].optional]).toEqual(['to_schedule', true]);
  });
  it('non inventa i valori mancanti: priorità/durata illeggibili restano da completare', () => {
    const bad = buildTable([[...header(740), ...row(720, 'PF-9', 'X', '1', '???', 'Urgente', 'Programmata', '-', '-')]])!;
    const r = tableToRows(bad, bad.mapping, []).rows[0];
    expect(r.include).toBe(false); expect(r.parseError).toMatch(/durata.*priorità.*/);
  });
  it('senza intestazione riconoscibile restituisce null', () => {
    expect(buildTable([line(700, [[20, 'solo testo libero'], [200, 'altro']])])).toBeNull();
  });
});

describe('valori', () => {
  it('durate', () => { for (const [s, m] of [['5h 11m', 311], ['2h07', 127], ['1h 00m', 60], ['45m', 45], ['02:50', 170], ['90', 90], ['abc', 0]] as const) expect(parseDuration(s)).toBe(m); });
  it('date senza anno, con anno, ISO e vuote', () => {
    expect(parseDate('17/11 19:00', 2026)).toBe('2026-11-17T19:00');
    expect(parseDate('3/1/2027 08:05', 2026)).toBe('2027-01-03T08:05');
    expect(parseDate('2026-11-17T21:22:00+01:00', 2026)).toBe('2026-11-17T21:22');
    expect(parseDate('-', 2026)).toBe(''); expect(parseDate('31/13 10:00', 2026)).toBeNull();
  });
});

describe('CSV', () => {
  it('virgolette, punto e virgola e a capo nei campi', () => {
    expect(parseCsv('a;b\r\n"x;1";"y ""q"""\r\n')).toEqual([['a', 'b'], ['x;1', 'y "q"']]);
  });
  it('esporta CSV e reimporta', () => {
    const j = { id: 'abcd1234', template_id: null, repetition_index: 1, name: 'Notturna, "v2"', pieces_per_plate: 3, duration_minutes: 366, priority: 'low', status: 'scheduled',
      optional: true, planned_start: '2026-11-17T20:22:00.000Z', planned_end: '2026-11-18T02:28:00.000Z', actual_start: null, actual_end: null, version: 1, notes: null, external_id: 'PF-7' } as Job;
    const r = readCsvTable(exportCsv([j])).table!;
    const [row] = tableToRows(r, r.mapping, []).rows;
    expect([row.name, row.pieces, row.duration, row.priority, row.status, row.start, row.optional, row.external_id])
      .toEqual(['Notturna, "v2"', 3, 366, 'low', 'scheduled', '2026-11-17T21:22', true, 'PF-7']);
  });
});
