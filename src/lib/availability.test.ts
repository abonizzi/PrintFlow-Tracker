import { describe, expect, it } from 'vitest';
import { checkStart, effective, type Exc, type Rule } from './availability';
import { fromInputValue } from './time';

const rules: Rule[] = Array.from({ length: 7 }, (_, d) => ({ id: String(d), weekday: d, wake_time: '05:30:00',
  leave_time: '07:15:00', return_time: '17:30:00', last_evening_start: '21:30:00' }));
const at = (s: string, ex: Exc[] = []) => checkStart(fromInputValue(s, 'Europe/Rome'), rules, ex);
const holiday = (d: string): Exc => ({ id: 'h', on_date: d, kind: 'holiday', wake_time: null, leave_time: null, return_time: null, last_evening_start: null, note: null });

describe('disponibilità', () => {
  it('orari validi senza avvisi (05:30, 05:45, 17:30, 21:22)', () => {
    for (const t of ['05:30', '05:45', '17:30', '21:22']) expect(at(`2026-11-18T${t}`)).toEqual([]);
  });
  it('avvisa fuori casa, dopo l\'ultimo avvio e prima del risveglio', () => {
    expect(at('2026-11-18T10:00')[0]).toMatch(/fuori casa/);
    expect(at('2026-11-18T22:00')[0]).toMatch(/ultimo avvio/);
    expect(at('2026-11-18T05:00')[0]).toMatch(/risveglio/);
  });
  it('il festivo elimina l\'assenza', () => {
    expect(at('2026-11-18T10:00', [holiday('2026-11-18')])).toEqual([]);
  });
  it('lunedì = weekday 0', () => {
    expect(effective('2026-11-16', rules, [])?.wake).toBe('05:30');
  });
});
