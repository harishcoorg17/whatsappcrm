import { describe, expect, it } from 'vitest';
import { parseGroupRegistration } from './group-registry';

describe('parseGroupRegistration', () => {
  it('accepts a minimal registration', () => {
    const r = parseGroupRegistration({ reference: 'abc', name: ' Kerala ' });
    expect(r).toEqual({
      ok: true,
      value: { reference: 'abc', name: 'Kerala', description: null, capacity: null, departureDate: null, createOnWhatsapp: false },
    });
  });

  it('accepts capacity and a real departure date', () => {
    const r = parseGroupRegistration({ reference: 'a', name: 'n', capacity: 20, departure_date: '2026-12-05' });
    expect(r.ok && r.value.capacity).toBe(20);
    expect(r.ok && r.value.departureDate).toBe('2026-12-05');
  });

  it('reads the create_on_whatsapp flag only when it is exactly true', () => {
    const on = parseGroupRegistration({ reference: 'a', name: 'n', create_on_whatsapp: true });
    const off = parseGroupRegistration({ reference: 'a', name: 'n', create_on_whatsapp: 'yes' });
    expect(on.ok && on.value.createOnWhatsapp).toBe(true);
    expect(off.ok && off.value.createOnWhatsapp).toBe(false);
  });

  it.each([
    [null],
    [{ name: 'n' }],
    [{ reference: 'a' }],
    [{ reference: 'a', name: 'n', capacity: 0 }],
    [{ reference: 'a', name: 'n', departure_date: '2026-02-31' }],
    [{ reference: 'a'.repeat(129), name: 'n' }],
  ])('rejects invalid input %#', (body) => {
    expect(parseGroupRegistration(body).ok).toBe(false);
  });
});
