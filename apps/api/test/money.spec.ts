import { parseAmountToPaise, formatInr, paiseToRupeeString } from '../src/common/utils/money.util';

describe('money utils', () => {
  it('parses statement amount strings into paise', () => {
    expect(parseAmountToPaise('1,000.00')).toBe(100000);
    expect(parseAmountToPaise('2500')).toBe(250000);
    expect(parseAmountToPaise(' 1 000.50 ')).toBe(100050);
    expect(parseAmountToPaise(1000)).toBe(100000);
  });

  it('rejects values that are not amounts', () => {
    expect(parseAmountToPaise('')).toBeNull();
    expect(parseAmountToPaise('n/a')).toBeNull();
    expect(parseAmountToPaise(null)).toBeNull();
    expect(parseAmountToPaise(undefined)).toBeNull();
  });

  it('formats paise without floating point drift', () => {
    expect(paiseToRupeeString(100000)).toBe('1000.00');
    expect(paiseToRupeeString(1)).toBe('0.01');
    expect(formatInr(123456)).toBe('\u20B91,234.56');
  });
});
