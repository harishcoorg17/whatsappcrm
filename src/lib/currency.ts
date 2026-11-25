/** The CRM's default currency: Indian rupees, shown with Indian digit grouping (₹12,34,567). */
export const DEFAULT_CURRENCY = 'INR';

export function formatMoney(
  value: number | string | null | undefined,
  currency?: string | null
): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || DEFAULT_CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}
