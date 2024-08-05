import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';

export class UpdateTxHashDto {
  @ApiProperty()
  @IsString()
  @Transform(({ value }) => value?.trim()?.toLowerCase())
  txhash: string;
}
