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

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateEntryDto {
  @IsString()
  @Transform(trim)
  @Length(2, 120, { message: 'Name must be between 2 and 120 characters' })
  guestName!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(0, 240)
  guestAddress?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^[0-9+\-\s()]{6,20}$/, { message: 'Phone number looks invalid' })
  guestPhone?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(0, 60)
  relation?: string;

  /** Amount in integer paise. The client sends paise so no float ever crosses the wire. */
  @Type(() => Number)
  @IsInt({ message: 'Amount must be a whole number of paise' })
  @Min(100, { message: 'Minimum contribution is 1 rupee' })
  @Max(10_000_000, { message: 'Maximum contribution is 1,00,000 rupees' })
  amountPaise!: number;

  @IsOptional()
  @IsIn(['UPI', 'CASH'])
  paymentMethod?: 'UPI' | 'CASH';

  @IsOptional()
  @IsString()
  @Length(0, 280)
  note?: string;

  /**
   * Client generated idempotency key. A retried submit with the same key
   * returns the original entry instead of creating a duplicate.
   */
  @IsOptional()
  @IsString()
  @Length(8, 64)
  clientRequestId?: string;
}
