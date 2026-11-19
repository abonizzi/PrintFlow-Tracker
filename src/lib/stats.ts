import { MIN, TZ_DEFAULT, fmtTime, segmentForDay, shiftDay } from './time';
import type { Job } from '../hooks/useJobs';

export interface JobConflict { a: Job; b: Job; reason: 'overlap' | 'min_gap' }
const live = (j: Job) => (j.status === 'scheduled' || j.status === 'in_progress') && !!j.planned_start && !!j.planned_end;
const byStart = (x: Job, y: Job) => new Date(x.planned_start!).getTime() - new Date(y.planned_start!).getTime();

/** Sovrapposizioni e intervalli sotto il minimo tra lavorazioni programmate/in corso (confronto con la fine più tarda finora). */
export function findConflicts(jobs: Job[], gapMin: number): JobConflict[] {
  const list = jobs.filter(live).sort(byStart); const out: JobConflict[] = [];
  let prev: Job | null = null;
  for (const j of list) {
    if (prev) {
      const gap = new Date(j.planned_start!).getTime() - new Date(prev.planned_end!).getTime();
      if (gap < 0) out.push({ a: prev, b: j, reason: 'overlap' });
      else if (gap < gapMin * MIN) out.push({ a: prev, b: j, reason: 'min_gap' });
    }
    if (!prev || new Date(j.planned_end!) > new Date(prev.planned_end!)) prev = j;
  }
  return out;
}

/** Minuti programmati per giorno locale; le stampe notturne si dividono tra i due giorni. */
export function minutesPerDay(jobs: Job[], tz = TZ_DEFAULT): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of jobs.filter(live)) {
    let day = fmtTime(j.planned_start!, tz, 'yyyy-MM-dd');
    const last = fmtTime(new Date(new Date(j.planned_end!).getTime() - 1), tz, 'yyyy-MM-dd');
    for (let i = 0; i < 400; i++) {
      const seg = segmentForDay(j.planned_start!, j.planned_end!, day, tz);
      if (seg) out[day] = (out[day] ?? 0) + seg.durMin;
      if (day >= last) break;
      day = shiftDay(day, 1);
    }
  }
  return out;
}

export function computeStats(jobs: Job[], now: Date, gapMin: number, tz = TZ_DEFAULT) {
  const count = (s: Job['status']) => jobs.filter(j => j.status === s).length;
  const active = jobs.filter(j => j.status !== 'cancelled');
  const counted = active.filter(j => !j.optional || j.status === 'completed');   // le opzionali non confermate non pesano sulla percentuale
  const done = counted.filter(j => j.status === 'completed').length;
  const upcoming = jobs.filter(live).filter(j => new Date(j.planned_end!) > now).sort(byStart);
  let idleMin = 0;
  for (let i = 1; i < upcoming.length; i++) {
    const g = (new Date(upcoming[i].planned_start!).getTime() - new Date(upcoming[i - 1].planned_end!).getTime()) / MIN;
    if (g > 0) idleMin += g;
  }
  return {
    total: jobs.length, toSchedule: count('to_schedule'), scheduled: count('scheduled'), inProgress: count('in_progress'),
    completed: count('completed'), cancelled: count('cancelled'),
    optionalPending: active.filter(j => j.optional && j.status !== 'completed').length,
    remainingMin: active.filter(j => !j.optional && j.status !== 'completed').reduce((s, j) => s + j.duration_minutes, 0),
    completionPct: counted.length ? Math.round((done / counted.length) * 100) : 0,
    next: jobs.filter(j => j.status === 'scheduled' && j.planned_start && new Date(j.planned_start) > now).sort(byStart)[0] ?? null,
    perDay: minutesPerDay(jobs, tz), conflicts: findConflicts(jobs, gapMin), idleMin,
  };
}
