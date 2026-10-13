import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

const STATUSES = Object.values(PaymentStatus);
const METHODS = Object.values(PaymentMethod);

export class QueryEntriesDto {
  /**
   * Which workspace to read. Only ever a request: the server resolves the
   * caller's membership and uses that, so sending another customer's id
   * cannot widen what comes back.
   */
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  /** Free text across guest name, address, phone, entry code and claimed UTR. */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsIn(STATUSES, { each: true })
  status?: PaymentStatus[];

  @IsOptional()
  @IsIn(METHODS)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAmountPaise?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAmountPaise?: number;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @IsIn(['createdAt', 'amountPaise', 'guestName', 'entryNumber'])
  sortBy?: 'createdAt' | 'amountPaise' | 'guestName' | 'entryNumber';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
