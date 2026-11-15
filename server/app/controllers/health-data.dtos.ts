import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class HealthSyncDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

export class HealthConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  syncIntervalHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  syncDays?: number;
}

export class HealthLoginCancelDto {
  @IsString()
  @MinLength(1)
  sessionId!: string;
}

export class HealthDailyQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from 格式应为 yyyy-MM-dd' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to 格式应为 yyyy-MM-dd' })
  to?: string;
}

export class HealthSleepQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 格式应为 yyyy-MM-dd' })
  date!: string;
}

export class HealthWeightQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}