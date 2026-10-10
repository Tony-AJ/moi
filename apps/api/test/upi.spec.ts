import { buildUpiLink, isValidVpa } from '../src/common/utils/upi.util';

describe('UPI link builder', () => {
  it('prefills the amount in rupees with two decimals', () => {
    const link = buildUpiLink({
      payeeVpa: 'someone@okicici',
      payeeName: 'Kumar Family',
      amountPaise: 100000,
      transactionNote: 'Moi MOI-000123',
      referenceId: 'MOI-000123',
    });

    const params = new URLSearchParams(link.split('?')[1]);
    expect(link.startsWith('upi://pay?')).toBe(true);
    expect(params.get('pa')).toBe('someone@okicici');
    expect(params.get('am')).toBe('1000.00');
    expect(params.get('cu')).toBe('INR');
    expect(params.get('tr')).toBe('MOI-000123');
  });

  it('validates VPAs', () => {
    expect(isValidVpa('name@okicici')).toBe(true);
    expect(isValidVpa('name.surname-1@okhdfcbank')).toBe(true);
    expect(isValidVpa('not-a-vpa')).toBe(false);
    expect(isValidVpa('a@b@c')).toBe(false);
  });
});
