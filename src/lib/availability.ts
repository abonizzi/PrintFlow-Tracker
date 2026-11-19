import { getISODay, parseISO } from 'date-fns';
import { TZ_DEFAULT, fmtTime } from './time';

export interface Rule { id: string; weekday: number; wake_time: string; leave_time: string | null; return_time: string | null; last_evening_start: string }
export interface Exc { id: string; on_date: string; kind: 'holiday' | 'custom'; wake_time: string | null; leave_time: string | null; return_time: string | null; last_evening_start: string | null; note: string | null }
export interface Settings { changeover_minutes: number; snap_minutes: number; timezone: string }
export interface Avail { wake: string; leave: string | null; ret: string | null; last: string }
export const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** Disponibilità effettiva di un giorno (yyyy-MM-dd): regola settimanale + eventuale eccezione. weekday 0 = lunedì. */
export function effective(day: string, rules: Rule[], exceptions: Exc[]): Avail | null {
  const r = rules.find(x => x.weekday === getISODay(parseISO(day)) - 1);
  if (!r) return null;
  const base: Avail = { wake: hm(r.wake_time)!, leave: hm(r.leave_time), ret: hm(r.return_time), last: hm(r.last_evening_start)! };
  const e = exceptions.find(x => x.on_date === day);
  if (!e) return base;
  const wake = hm(e.wake_time) ?? base.wake, last = hm(e.last_evening_start) ?? base.last;
  if (e.kind === 'holiday') return { wake, leave: null, ret: null, last };   // festivo: a casa tutto il giorno
  return { wake, leave: hm(e.leave_time) ?? base.leave, ret: hm(e.return_time) ?? base.ret, last };
}

/** Avvisi (mai blocchi) per un inizio stampa: serve una finestra in cui puoi intervenire sul piatto. */
export function checkStart(start: Date, rules: Rule[], exceptions: Exc[], tz = TZ_DEFAULT): string[] {
  const a = effective(fmtTime(start, tz, 'yyyy-MM-dd'), rules, exceptions);
  if (!a) return [];
  const t = fmtTime(start, tz);
  if (t < a.wake) return [`Inizio alle ${t}, prima del risveglio (${a.wake})`];
  if (t > a.last) return [`Inizio alle ${t}, dopo l'ultimo avvio serale consentito (${a.last})`];
  if (a.leave && a.ret && t >= a.leave && t < a.ret)
    return [`Inizio alle ${t} mentre sei fuori casa (${a.leave}–${a.ret}): non potrai cambiare il piatto`];
  return [];
}
