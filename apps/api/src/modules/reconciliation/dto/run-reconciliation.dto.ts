import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RunReconciliationDto {
  @IsString()
  eventId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  dateWindowDaysBefore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  dateWindowDaysAfter?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enableAmountFallback?: boolean;
}
