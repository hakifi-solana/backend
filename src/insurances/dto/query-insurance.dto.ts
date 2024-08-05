import { ApiPropertyOptional } from '@nestjs/swagger';
import { InsuranceState } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dtos/pagination-query.dto';

export class ListInsuranceQueryDto extends PaginationQueryDto {
  allowSortFields = [
    'createdAt',
    'updatedAt',
    'closedAt',
    'expiredAt',
    'asset',
    'p_open',
    'p_claim',
    'q_claim',
    'margin',
    'q_covered',
    'txhash',
    'status',
  ];

  userId: string;

  @ApiPropertyOptional({
    default: '-createdAt,-closedAt',
  })
  @IsOptional()
  @IsString()
  sort?: string = '-createdAt,-closedAt';

  @ApiPropertyOptional({
    enum: InsuranceState,
    // default: InsuranceState.AVAILABLE,
  })
  @IsOptional()
  @IsEnum(InsuranceState)
  state?: InsuranceState;

  @ApiPropertyOptional({
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  isClosed?: boolean;

  @ApiPropertyOptional({
    default: new Date(2024, 1, 1, 0, 0, 0, 0),
  })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => new Date(value))
  closedFrom?: Date;

  @ApiPropertyOptional({
    default: new Date(),
  })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => new Date(value))
  closedTo?: Date;

  @ApiPropertyOptional({
    default: new Date(2024, 1, 1, 0, 0, 0, 0),
  })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => new Date(value))
  createdFrom?: Date;

  @ApiPropertyOptional({
    default: new Date(),
  })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => new Date(value))
  createdTo?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.toUpperCase())
  asset?: string;
}
