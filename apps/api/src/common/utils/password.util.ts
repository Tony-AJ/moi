import { randomInt } from 'crypto';

// No 0/O, 1/l/I: these get read aloud over the phone and typed from a
// WhatsApp message, so every character has to be unambiguous.
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;

/**
 * One-time password for a login issued by a super admin, e.g. "Kq7M-x3Pa-9WtZ".
 * Twelve random characters from a 54-symbol alphabet is about 69 bits, and
 * the account is forced to replace it at first sign-in anyway.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    let raw = '';
    for (let i = 0; i < 12; i += 1) raw += ALL[randomInt(ALL.length)];
    if (/[A-Z]/.test(raw) && /[a-z]/.test(raw) && /[2-9]/.test(raw)) {
      return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
    }
  }
}
