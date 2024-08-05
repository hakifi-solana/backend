import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { TokensService } from './tokens.service';
import { ListTokenQueryDto } from './dto/token-query.dto';
import { ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';

@Controller('tokens')
@ApiTags('Tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get()
  findAll(@Query() query: ListTokenQueryDto) {
    return this.tokensService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id', ParseObjectIdPipe) id: string) {
    const token = await this.tokensService.findOne(id);
    if (!token) {
      throw new NotFoundException('Token not found');
    }
    return token;
  }
}
