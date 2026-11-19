import { describe, expect, it } from 'vitest';
import type { Job } from '../hooks/useJobs';
import { computeStats, findConflicts, minutesPerDay } from './stats';
import { computeEnd, fromInputValue } from './time';

const TZ = 'Europe/Rome';
const mk = (id: string, status: Job['status'], start: string | null, dur: number, extra: Partial<Job> = {}): Job => {
  const s = start ? fromInputValue(start, TZ) : null;
  return { id, template_id: null, repetition_index: 1, name: id, pieces_per_plate: 1, duration_minutes: dur, priority: 'medium', status,
    optional: false, planned_start: s?.toISOString() ?? null, planned_end: s ? computeEnd(s, dur).toISOString() : null,
    version: 1, notes: null, actual_start: null, actual_end: null, ...extra };
};

describe('statistiche', () => {
  const jobs = [mk('done', 'completed', null, 311), mk('a', 'scheduled', '2026-11-17T19:00', 127), mk('b', 'scheduled', '2026-11-17T21:22', 366),
    mk('opt', 'to_schedule', null, 170, { optional: true }), mk('x', 'cancelled', null, 60)];
  const st = computeStats(jobs, fromInputValue('2026-11-17T20:00', TZ), 15);
  it('conteggi e percentuale (opzionali escluse)', () => {
    expect([st.total, st.completed, st.scheduled, st.toSchedule, st.cancelled]).toEqual([5, 1, 2, 1, 1]);
    expect(st.completionPct).toBe(33);
    expect(st.remainingMin).toBe(127 + 366);
    expect(st.optionalPending).toBe(1);
  });
  it('prossima stampa e tempo libero', () => {
    expect(st.next?.id).toBe('b');
    expect(st.idleMin).toBe(15);
  });
  it('ore per giorno con stampa notturna', () => {
    expect(minutesPerDay([jobs[2]])).toEqual({ '2026-11-17': 158, '2026-11-18': 208 });
  });
  it('rileva sovrapposizione e intervallo minimo', () => {
    expect(findConflicts(jobs, 15)).toEqual([]);
    expect(findConflicts([jobs[1], mk('c', 'scheduled', '2026-11-17T21:10', 30)], 15)[0].reason).toBe('min_gap');
    expect(findConflicts([jobs[1], mk('c', 'scheduled', '2026-11-17T20:00', 30)], 15)[0].reason).toBe('overlap');
  });
});
