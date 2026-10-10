import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Resolve a REVIEW_REQUIRED entry. */
export class ReviewEntryDto {
  /**
   * MATCH_TRANSACTION - link a specific bank credit and verify.
   * REJECT            - organizer states the money never arrived.
   * RESET             - send it back to AWAITING_VERIFICATION.
   * CONFIRM_CASH      - organizer attests cash was received in hand.
   */
  @IsIn(['MATCH_TRANSACTION', 'REJECT', 'RESET', 'CONFIRM_CASH'])
  action!: 'MATCH_TRANSACTION' | 'REJECT' | 'RESET' | 'CONFIRM_CASH';

  @IsOptional()
  @IsString()
  bankTransactionId?: string;

  @IsString()
  @Length(3, 280, { message: 'A short reason is required so the decision is auditable' })
  reason!: string;
}

/** Admin-recorded entry (cash in hand, or a guest who could not use the form). */
export class CreateManualEntryDto {
  @IsString()
  eventId!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @Length(2, 120)
  guestName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  guestAddress?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{6,20}$/)
  guestPhone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  relation?: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  amountPaise!: number;

  @IsIn(['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER'])
  paymentMethod!: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'OTHER';

  /** Cash in hand can be attested by the organizer at entry time. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  confirmReceived?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 280)
  note?: string;
}

export class AdminSubmitReferenceDto {
  @IsString()
  @Length(6, 40)
  utr!: string;
}
