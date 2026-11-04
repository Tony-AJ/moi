import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/**
 * One organizer, one workspace, one event, created together. The organizer
 * becomes the workspace owner and receives a one-time password.
 */
export class ProvisionOrganizerDto {
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  organizerName!: string;

  @IsEmail({}, { message: 'Enter a valid email address for the organizer' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  organizerEmail!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(/^[0-9+\-\s()]{6,20}$/, { message: 'Phone number looks invalid' })
  organizerPhone?: string;

  /** Defaults to the host name, then the organizer's name. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(3, 120)
  workspaceName?: string;

  @IsString()
  @Transform(trim)
  @Length(3, 160)
  eventName!: string;

  @IsDateString()
  eventDate!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(0, 120)
  hostName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(0, 240)
  venue?: string;

  /** The organizer's UPI account. Guests pay straight into it. */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, { message: 'Enter a valid UPI ID' })
  upiId!: string;

  @IsString()
  @Transform(trim)
  @Length(2, 120)
  payeeName!: string;

  /** Organizer's password, chosen by the super admin. Left out: generated. */
  @IsOptional()
  @IsString()
  @Length(10, 128, { message: 'Password must be at least 10 characters' })
  password?: string;
}

/** Another event for an organizer who already has a workspace. */
export class AddWorkspaceEventDto {
  @IsString()
  @Transform(trim)
  @Length(3, 160)
  eventName!: string;

  @IsDateString()
  eventDate!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(0, 120)
  hostName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(0, 240)
  venue?: string;

  /**
   * Optional: leave out to reuse the organizer's existing confirmed UPI
   * account, give one to collect this event into a different account.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, { message: 'Enter a valid UPI ID' })
  upiId?: string;

  @ValidateIf((dto: AddWorkspaceEventDto) => Boolean(dto.upiId))
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  payeeName?: string;
}

export class UpdatePlatformUserDto {
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateWorkspaceStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status!: 'ACTIVE' | 'SUSPENDED';

  /** Required when suspending, so the organizer can be told why. */
  @ValidateIf((dto: UpdateWorkspaceStatusDto) => dto.status === 'SUSPENDED')
  @IsString()
  @Transform(trim)
  @Length(3, 280, { message: 'Give a short reason for the suspension' })
  reason?: string;
}

/** Optional: leave out to have a password generated. */
export class SetPasswordDto {
  @IsOptional()
  @IsString()
  @Length(10, 128, { message: 'Password must be at least 10 characters' })
  password?: string;
}
