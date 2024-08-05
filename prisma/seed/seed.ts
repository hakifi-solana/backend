import {
  BaseUnit,
  InsuranceSide,
  InsuranceState,
  PrismaClient,
} from '@prisma/client';
const fs = require('fs');

const prisma = new PrismaClient();

async function main() {
  let allTokens = await prisma.token.findMany({
    select: {
      symbol: true,
    },
  });
  if (allTokens.length === 0) {
    const tokens = JSON.parse(
      fs.readFileSync('prisma/seed/data/tokens.json', 'utf8'),
    );
    await prisma.token.createMany({
      data: tokens,
    });

    allTokens = await prisma.token.findMany({
      select: {
        symbol: true,
      },
    });
  }

  let allPairs = await prisma.pair.findMany();

  if (!allPairs.length) {
    const pairs = allTokens.map((token) => ({
      asset: token.symbol,
      unit: BaseUnit.USDT,
      symbol: `${token.symbol}${BaseUnit.USDT}`,
    }));

    await prisma.pair.createMany({
      data: pairs,
    });

    allPairs = await prisma.pair.findMany();
  }

  const result: any = await prisma.insurance.aggregateRaw({
    pipeline: [
      {
        $match: {
          state: {
            $nin: [InsuranceState.PENDING, InsuranceState.INVALID],
          },
        },
      },
      {
        $group: {
          _id: {
            asset: '$asset',
            unit: '$unit',
          },
          totalContract: {
            $sum: 1,
          },
          margin: {
            $sum: '$margin',
          },
          q_covered: {
            $sum: '$q_covered',
          },
          claimed: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$state',
                    [InsuranceState.CLAIMED, InsuranceState.CLAIM_WAITING],
                  ],
                },
                '$q_claim',
                0,
              ],
            },
          },
          refunded: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$state',
                    [InsuranceState.REFUNDED, InsuranceState.REFUND_WAITING],
                  ],
                },
                '$margin',
                0,
              ],
            },
          },
          totalBull: {
            $sum: {
              $cond: [
                {
                  $eq: ['$side', InsuranceSide.BULL],
                },
                1,
                0,
              ],
            },
          },
          totalBear: {
            $sum: {
              $cond: [
                {
                  $eq: ['$side', InsuranceSide.BEAR],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $addFields: {
          payback: {
            $add: ['$claimed', '$refunded'],
          },
        },
      },
    ],
  });

  for (const item of result) {
    const symbol = `${item._id.asset}${item._id.unit}`;
    await prisma.pairMarketStat.upsert({
      where: {
        symbol,
      },
      create: {
        symbol,
        asset: item._id.asset,
        unit: item._id.unit,
        totalContract: item.totalContract,
        margin: item.margin,
        q_covered: item.q_covered,
        claimed: item.claimed,
        refunded: item.refunded,
        totalBull: item.totalBull,
        totalBear: item.totalBear,
        payback: item.payback,
      },
      update: {
        totalContract: item.totalContract,
        margin: item.margin,
        q_covered: item.q_covered,
        claimed: item.claimed,
        refunded: item.refunded,
        totalBull: item.totalBull,
        totalBear: item.totalBear,
        payback: item.payback,
      },
    });
  }

  // Update PNL Insurances
  const insurances = await prisma.insurance.findMany();
  for (const insurance of insurances) {
    let pnlUser = 0;
    switch (insurance.state) {
      case InsuranceState.CLAIMED:
      case InsuranceState.CLAIM_WAITING:
        pnlUser = insurance.q_claim - insurance.margin;
        break;
      case InsuranceState.LIQUIDATED:
      case InsuranceState.EXPIRED:
        pnlUser = -insurance.margin;
        break;
      default:
        break;
    }

    await prisma.insurance.update({
      where: {
        id: insurance.id,
      },
      data: {
        pnlUser,
        pnlProject: -pnlUser,
      },
    });
  }

  // const pairMarketSymbols = result.map(
  //   (item) => `${item._id.asset}${item._id.unit}`,
  // );

  // await prisma.pairMarketStat.createMany({
  //   data: allPairs
  //     .filter((pair) => !pairMarketSymbols.includes(pair.symbol))
  //     .map((pair) => ({
  //       symbol: pair.symbol,
  //       asset: pair.asset,
  //       unit: pair.unit,
  //       totalContract: 0,
  //       margin: 0,
  //       q_covered: 0,
  //       claimed: 0,
  //       refunded: 0,
  //       totalBull: 0,
  //       totalBear: 0,
  //       payback: 0,
  //     })),
  // });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
