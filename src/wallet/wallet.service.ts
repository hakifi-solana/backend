import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { WalletsQueryDto } from './dto/query-wallet.dto';

@Injectable()
export class WalletService {
  constructor(private readonly prismaService: PrismaService) {}

  async getWallets(query: WalletsQueryDto) {
    const { userId, asset } = query;
    if (asset) {
      const wallet = await this.prismaService.wallet.findUnique({
        where: {
          userId_asset: {
            userId,
            asset,
          },
        },
      });
      if (!!wallet) return wallet;

      return await this.prismaService.wallet.create({
        data: { asset, userId },
      });
    }

    return this.prismaService.wallet.findMany({
      where: {
        userId,
      },
    });
  }
}
