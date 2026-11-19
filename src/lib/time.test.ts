import { describe, expect, it } from 'vitest';
import { computeEnd, dayBounds, fmtTime, fromInputValue, segmentForDay, snapTo } from './time';
const TZ = 'Europe/Rome';
const at = (d: Date) => fmtTime(d, TZ, 'yyyy-MM-dd HH:mm');

describe('calcolo orari', () => {
  it('21:22 + 6h06 attraversa la mezzanotte', () => {
    expect(at(computeEnd(fromInputValue('2026-11-17T21:22', TZ), 366))).toBe('2026-11-18 03:28');
  });
  it('durata superiore a 24 ore', () => {
    expect(at(computeEnd(fromInputValue('2026-11-17T10:00', TZ), 1800))).toBe('2026-11-18 16:00');
  });
  it('giorni di 23, 24 e 25 ore', () => {
    expect(dayBounds('2027-03-28', TZ).minutes).toBe(1380);
    expect(dayBounds('2026-11-17', TZ).minutes).toBe(1440);
    expect(dayBounds('2026-10-25', TZ).minutes).toBe(1500);
  });
  it('cambio ora legale: 5 ore reali dalle 23:00 finiscono alle 03:00', () => {
    expect(at(computeEnd(fromInputValue('2026-10-24T23:00', TZ), 300))).toBe('2026-10-25 03:00');
  });
  it('snap a 5 e 15 minuti', () => {
    expect(at(snapTo(fromInputValue('2026-11-17T21:22', TZ), 5))).toBe('2026-11-17 21:20');
    expect(at(snapTo(fromInputValue('2026-11-17T21:22', TZ), 15))).toBe('2026-11-17 21:15');
  });
  it('blocco notturno diviso sui due giorni', () => {
    const s = fromInputValue('2026-11-17T21:22', TZ), e = computeEnd(s, 366);
    const d1 = segmentForDay(s.toISOString(), e.toISOString(), '2026-11-17', TZ)!;
    const d2 = segmentForDay(s.toISOString(), e.toISOString(), '2026-11-18', TZ)!;
    expect([d1.startMin, d1.durMin, d1.continuesAfter]).toEqual([1282, 158, true]);
    expect([d2.startMin, d2.durMin, d2.continuesBefore]).toEqual([0, 208, true]);
    expect(segmentForDay(s.toISOString(), e.toISOString(), '2026-11-19', TZ)).toBeNull();
  });
});
