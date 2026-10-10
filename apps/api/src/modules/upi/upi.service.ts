import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  constructor(private readonly config: ConfigService) {}

  resolvePayee(event: UpiPayeeConfig): { vpa: string; name: string } {
    const vpa = event.upiId ?? this.config.get<string>('DEFAULT_UPI_ID') ?? '';
    const name =
      event.upiPayeeName ?? this.config.get<string>('DEFAULT_UPI_PAYEE_NAME') ?? 'Moi Ledger';
    return { vpa, name };
  }

  isConfigured(event: UpiPayeeConfig): boolean {
    const { vpa } = this.resolvePayee(event);
    return Boolean(vpa) && isValidVpa(vpa);
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
