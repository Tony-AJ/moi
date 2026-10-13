import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateBeneficiaryDto {
  /**
   * Which workspace to create the account in. Only a request: the server
   * resolves the caller's membership and uses that.
   *
   * It is declared here rather than intersected onto the parameter type,
   * because an intersection makes TypeScript emit Object as the parameter
   * type and the ValidationPipe then skips the body entirely.
   */
  @IsOptional()
  @IsString()
  workspaceId?: string;

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
