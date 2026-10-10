/**
 * UPI UTRs are printed inconsistently across apps and statements
 * ("UPI/412345678901/...", "412345678901", "4123-4567-8901").
 * Matching only ever happens on the normalized form.
 */
export function normalizeReference(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length ? normalized : null;
}

/**
 * Pulls candidate reference tokens out of a free-form statement narration.
 * Example: "UPI/CR/412345678901/ARUN KUMAR/ICIC/arun@okicici" yields
 * ["UPICR412345678901ARUNKUMARICICARUNOKICICI", "412345678901", ...].
 */
export function extractReferenceCandidates(description: string | null | undefined): string[] {
  if (!description) return [];
  const upper = String(description).toUpperCase();
  const candidates = new Set<string>();
  const whole = normalizeReference(upper);
  if (whole) candidates.add(whole);
  for (const token of upper.split(/[^A-Z0-9]+/)) {
    if (token.length >= 6) candidates.add(token);
  }
  return [...candidates];
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}
