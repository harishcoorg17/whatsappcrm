import { describe, expect, it } from 'vitest';
import { DEFAULT_CURRENCY, formatMoney } from './currency';

describe('formatMoney', () => {
  it('defaults to rupees with Indian digit grouping', () => {
    expect(DEFAULT_CURRENCY).toBe('INR');
    expect(formatMoney(1234567)).toBe('₹12,34,567');
  });

  it('treats a missing currency as rupees', () => {
    expect(formatMoney(5000, null)).toBe('₹5,000');
    expect(formatMoney(5000, '')).toBe('₹5,000');
  });

  it('keeps an explicit currency such as a deal saved in dollars', () => {
    expect(formatMoney(1500, 'USD')).toContain('$');
  });

  it('shows zero for empty or invalid values', () => {
    expect(formatMoney(null)).toBe('₹0');
    expect(formatMoney('abc')).toBe('₹0');
    expect(formatMoney('2500')).toBe('₹2,500');
  });
});
