import { paiseToRupeeString } from './money.util';

export interface UpiLinkInput {
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  /** Shown as the note inside the UPI app. */
  transactionNote?: string;
  /** Our own entry code; echoed back by some apps as the merchant ref. */
  referenceId?: string;
}

/**
 * Builds a UPI intent deep link with the amount prefilled.
 * The guest still authorises the payment inside their UPI app — returning from
 * the app is NOT proof of payment.
 */
export function buildUpiLink(input: UpiLinkInput): string {
  const params = new URLSearchParams();
  params.set('pa', input.payeeVpa);
  params.set('pn', input.payeeName);
  params.set('am', paiseToRupeeString(input.amountPaise));
  params.set('cu', 'INR');
  if (input.transactionNote) params.set('tn', input.transactionNote.slice(0, 50));
  if (input.referenceId) params.set('tr', input.referenceId);
  return `upi://pay?${params.toString()}`;
}

const VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export function isValidVpa(vpa: string): boolean {
  return VPA_REGEX.test(vpa);
}
