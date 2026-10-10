import { randomBytes, createHash } from 'crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

/** URL safe, unambiguous opaque token for guest status lookups. */
export function generateAccessToken(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildEntryCode(entryNumber: number): string {
  return `MOI-${String(entryNumber).padStart(6, '0')}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
