import { Injectable } from '@nestjs/common';
import { buildUpiLink, isValidVpa } from '../../common/utils/upi.util';
import { paiseToRupeeString } from '../../common/utils/money.util';

export interface UpiPayeeConfig {
  upiId: string | null;
  upiPayeeName: string | null;
}

export interface UpiHandoff {
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  amountRupees: string;
  transactionNote: string;
  referenceId: string;
  /** Generic UPI intent link; works with any app registered for upi:// */
  upiLink: string;
  /** App-specific links for desktop/Android browsers that need an explicit scheme. */
  appLinks: Record<string, string>;
  /** Reminder rendered on the guest UI. */
  disclaimer: string;
}

@Injectable()
export class UpiService {
  /**
   * There is deliberately no platform-wide default here.
   *
   * A fallback to a DEFAULT_UPI_ID environment variable used to apply when an
   * event had no UPI id of its own, which meant a misconfigured customer
   * event quietly collected its guests' money into the platform's own
   * account. Each event must resolve to the beneficiary its own owner
   * configured, or to nothing at all.
   */
  resolvePayee(event: UpiPayeeConfig): { vpa: string; name: string } {
    return { vpa: event.upiId ?? '', name: event.upiPayeeName ?? '' };
  }

  isConfigured(event: UpiPayeeConfig): boolean {
    const { vpa, name } = this.resolvePayee(event);
    return Boolean(vpa) && Boolean(name) && isValidVpa(vpa);
  }

  buildHandoff(params: {
    event: UpiPayeeConfig & { name: string };
    amountPaise: number;
    entryCode: string;
  }): UpiHandoff {
    const { vpa, name } = this.resolvePayee(params.event);
    const transactionNote = `Moi ${params.entryCode}`;
    const base = {
      payeeVpa: vpa,
      payeeName: name,
      amountPaise: params.amountPaise,
      transactionNote,
      referenceId: params.entryCode,
    };
    const upiLink = buildUpiLink(base);
    const query = upiLink.split('?')[1];

    return {
      ...base,
      amountRupees: paiseToRupeeString(params.amountPaise),
      upiLink,
      appLinks: {
        gpay: `tez://upi/pay?${query}`,
        phonepe: `phonepe://pay?${query}`,
        paytm: `paytmmp://pay?${query}`,
      },
      disclaimer:
        'Approve the payment inside your UPI app. Returning to this page does not confirm payment — your contribution is marked verified only after it is matched against the bank statement.',
    };
  }
}
