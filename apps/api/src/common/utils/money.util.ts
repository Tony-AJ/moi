/**
 * All money is stored as integer paise. Never use floats for currency.
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupeeString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export function formatInr(paise: number): string {
  const value = Math.abs(paise) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${paise < 0 ? '-' : ''}₹${formatted}`;
}

/**
 * Parses a human/statement amount string ("1,000.50", "1000", "₹1 000") into paise.
 * Returns null when the value is not a usable number.
 */
export function parseAmountToPaise(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = String(input)
    .replace(/[₹$,\s]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
