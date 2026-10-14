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
