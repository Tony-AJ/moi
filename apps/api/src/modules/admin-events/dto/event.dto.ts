import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateEventDto {
  /**
   * Which workspace to create the event in. Only a request; the server uses
   * the caller's membership. Declared on the DTO rather than intersected
   * onto the parameter type, because an intersection makes TypeScript emit
   * Object and the ValidationPipe then validates nothing at all.
   */
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsString()
  @Length(3, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  hostName?: string;

  @IsDateString()
  eventDate!: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  venue?: string;

  /** Left blank, the slug is derived from the event name. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,59}$/, {
    message: 'Slug must be lowercase letters, numbers and hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, { message: 'Enter a valid UPI ID' })
  upiId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  upiPayeeName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(100, { each: true })
  suggestedAmounts?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  minAmountPaise?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  maxAmountPaise?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  collectPhone?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  requirePhone?: boolean;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  hostName?: string;

  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  venue?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, { message: 'Enter a valid UPI ID' })
  upiId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  upiPayeeName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @Type(() => Number)
  @IsInt({ each: true })
  suggestedAmounts?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  minAmountPaise?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  maxAmountPaise?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  collectPhone?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  requirePhone?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isOpen?: boolean;
}
