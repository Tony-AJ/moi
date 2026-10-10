import {
  extractReferenceCandidates,
  normalizePhone,
  normalizeReference,
} from '../src/common/utils/normalize.util';

describe('reference normalization', () => {
  it('strips formatting so the same UTR always compares equal', () => {
    expect(normalizeReference('412345678901')).toBe('412345678901'.toUpperCase());
    expect(normalizeReference('4123-4567-8901')).toBe('412345678901');
    expect(normalizeReference(' utr/412345678901 ')).toBe('UTR412345678901');
  });

  it('returns null for empty input', () => {
    expect(normalizeReference('')).toBeNull();
    expect(normalizeReference(null)).toBeNull();
    expect(normalizeReference('---')).toBeNull();
  });

  it('pulls reference tokens out of a narration', () => {
    const candidates = extractReferenceCandidates(
      'UPI/CR/412345678901/ARUN KUMAR/ICIC/arun@okicici',
    );
    expect(candidates).toContain('412345678901');
  });

  it('keeps the last ten digits of a phone number', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('')).toBeNull();
  });
});
