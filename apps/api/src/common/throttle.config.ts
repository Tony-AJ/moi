/**
 * Rate limits, read from the environment with the production defaults as
 * fallbacks.
 *
 * These were hardcoded, which left no way to tune them per environment and
 * made the end-to-end suite unrunnable: a few hundred calls in a few seconds
 * tripped the login limit and every assertion after it failed with 429.
 * Defaults are unchanged, so an environment that sets nothing behaves exactly
 * as before.
 */
function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const throttleConfig = {
  /** Baseline for every route. */
  get globalTtlMs(): number {
    return readLimit('THROTTLE_TTL_MS', 60_000);
  },
  get globalLimit(): number {
    return readLimit('THROTTLE_LIMIT', 120);
  },
  /** Login is the most attackable route, so it stays much tighter. */
  get loginLimit(): number {
    return readLimit('THROTTLE_LOGIN_LIMIT', 5);
  },
  /** Guest writes: entry creation and reference submission. */
  get guestWriteLimit(): number {
    return readLimit('THROTTLE_GUEST_WRITE_LIMIT', 10);
  },
  /** Guest reads: polling an entry's status. */
  get guestReadLimit(): number {
    return readLimit('THROTTLE_GUEST_READ_LIMIT', 60);
  },
};
