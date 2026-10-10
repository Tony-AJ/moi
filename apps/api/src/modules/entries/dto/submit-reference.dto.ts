import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class SubmitReferenceDto {
  /**
   * UPI UTR / reference number. Guests paste whatever their app shows, so we
   * accept a loose shape here and normalize before matching.
   */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(6, 40, { message: 'Reference must be 6 to 40 characters' })
  @Matches(/^[A-Za-z0-9\-/ ]+$/, { message: 'Reference contains invalid characters' })
  utr!: string;
}
