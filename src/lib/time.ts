import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const TZ_DEFAULT = 'Europe/Rome';
export const MIN = 60_000;

/** Inizio/fine reali del giorno locale (yyyy-MM-dd). Con l'ora legale dura 23h o 25h. */
export function dayBounds(day: string, tz = TZ_DEFAULT) {
  const next = format(addDays(parseISO(day), 1), 'yyyy-MM-dd');
  const start = fromZonedTime(`${day}T00:00:00`, tz);
  const end = fromZonedTime(`${next}T00:00:00`, tz);
  return { start, end, minutes: (end.getTime() - start.getTime()) / MIN };
}
export const todayStr = (tz = TZ_DEFAULT) => formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
export const shiftDay = (day: string, n: number) => format(addDays(parseISO(day), n), 'yyyy-MM-dd');

/** La durata è la fonte di verità: fine = inizio + durata (minuti trascorsi, non ore "da orologio"). */
export const computeEnd = (start: Date, durationMin: number) => new Date(start.getTime() + durationMin * MIN);
export const snapTo = (d: Date, step: number) => new Date(Math.round(d.getTime() / (step * MIN)) * step * MIN);

export const fmtTime = (d: Date | string, tz = TZ_DEFAULT, p = 'HH:mm') => formatInTimeZone(d, tz, p);
export const toInputValue = (d: Date | string, tz = TZ_DEFAULT) => formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm");
export const fromInputValue = (v: string, tz = TZ_DEFAULT) => fromZonedTime(v, tz);

/** Porzione di una lavorazione che cade nel giorno indicato (le notturne compaiono su due giorni). */
export function segmentForDay(startISO: string, endISO: string, day: string, tz = TZ_DEFAULT) {
  const { start: ds, end: de } = dayBounds(day, tz);
  const s = new Date(startISO), e = new Date(endISO);
  if (e <= ds || s >= de) return null;
  const cs = s < ds ? ds : s, ce = e > de ? de : e;
  return { startMin: (cs.getTime() - ds.getTime()) / MIN, durMin: (ce.getTime() - cs.getTime()) / MIN,
    continuesBefore: s < ds, continuesAfter: e > de };
}

export function hourMarks(day: string, tz = TZ_DEFAULT) {
  const { start, minutes } = dayBounds(day, tz);
  const out: { min: number; label: string }[] = [];
  for (let m = 0; m <= minutes; m += 60)
    out.push({ min: m, label: m === minutes ? '24:00' : fmtTime(new Date(start.getTime() + m * MIN), tz) });
  return out;
}
