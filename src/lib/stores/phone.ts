/**
 * Turn whatever phone string a store holds into digits with a country code,
 * or null when it cannot be a real number. Indian stores often hold bare
 * 10-digit numbers, so a default country code is applied to those.
 */
export function normalizeStorePhone(
  raw: unknown,
  defaultCountryCode = '91'
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  if (!hasPlus) {
    digits = digits.replace(/^0+/, '');
    if (digits.length <= 10) digits = `${defaultCountryCode}${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
