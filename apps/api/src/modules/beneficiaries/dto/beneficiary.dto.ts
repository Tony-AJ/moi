import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateBeneficiaryDto {
  @IsString()
  @Length(2, 60)
  label!: string;

  @IsString()
  @Length(3, 120)
  upiId!: string;

  @IsString()
  @Length(2, 80)
  payeeName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  bankName?: string;

  /**
   * Last four digits only. The API deliberately accepts no more than this:
   * a full account number is not needed to reconcile a statement.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'accountLast4 must be exactly 4 digits' })
  accountLast4?: string;
}

export class SelectBeneficiaryDto {
  @IsString()
  beneficiaryAccountId!: string;
}
