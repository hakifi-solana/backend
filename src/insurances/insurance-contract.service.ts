import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  ContractEventPayload,
  FallbackProvider,
  JsonRpcProvider,
  Wallet,
  WebSocketProvider,
  formatEther,
  parseEther,
} from 'ethers';
import { Config, ContractConfig } from 'src/configs/config.interface';
import * as dayjs from 'dayjs';
import { PrismaService } from 'nestjs-prisma';
import {
  Insurance,
  InsuranceState,
  StateLog,
  TransactionStatus,
  TransactionType,
  User,
} from '@prisma/client';
import { InsuranceHelper } from './insurance.helper';
import {
  INVALID_REASONS,
  InsuranceContractState,
  UnitContract,
} from './constant/insurance.contant';
import { PriceService } from 'src/price/price.service';
import { USDT_ABI } from 'src/configs/abi/usdt.abi';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INSURANCE_EVENTS } from 'src/common/constants/event';
import { debounce } from 'src/common/helpers/utils';
import { TransactionsService } from 'src/transactions/transactions.service';
import { FallbackProviderConfig } from 'ethers/lib.commonjs/providers/provider-fallback';

@Injectable()
export class InsuranceContractService implements OnModuleInit {
  logger = new Logger(InsuranceContractService.name);
  private contract: Contract;
  private fallbackProvider: FallbackProvider;
  private modWallet: Wallet;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService<Config>,
    private readonly priceService: PriceService,
    private readonly insuranceHelper: InsuranceHelper,
    private readonly eventEmitter: EventEmitter2,
    private readonly transactionService: TransactionsService,
  ) {
    const config = this.configService.get<ContractConfig>('contract');
    const providers: FallbackProviderConfig[] = [
      new JsonRpcProvider(config.rpcHttpUrl),
    ];

    if (config.rpcWsUrl) {
      providers.push(new WebSocketProvider(config.rpcWsUrl));
    }

    this.fallbackProvider = new FallbackProvider(providers);
    const modWallet = new Wallet(config.modPrivateKey, this.fallbackProvider);
    this.modWallet = modWallet;
    this.contract = new Contract(config.address, config.abi, modWallet);
    this.onEventInsurance = debounce(this.onEventInsurance.bind(this), 30);
  }

  onModuleInit() {
    this.initEvents();
  }

  private initEvents() {
    this.contract.on('EInsurance', this.onEventInsurance.bind(this));
  }

  private onEventInsurance(
    id: string,
    address: string,
    b_unit: bigint,
    b_margin: bigint,
    b_q_claim: bigint,
    b_expired_at: bigint,
    b_created_at: bigint,
    b_state: bigint,
    b_type: bigint,
    eventPayload: ContractEventPayload,
  ) {
    const margin = parseFloat(formatEther(b_margin));
    const eventType = Number(b_type);
    const txhash = eventPayload.log.transactionHash;
    const unit = UnitContract[Number(b_unit)];

    switch (eventType) {
      case 0: // CREATE
        this.logger.verbose('onContractCreated');
        this.onContractCreated(id, address, unit, margin, txhash);
        break;
      case 1: // UPDATE_AVAILABLE
        break;
      case 2: // UPDATE_INVALID
        break;
      case 3: // REFUND
        this.logger.verbose('onContractStateChanged', {
          id,
          state: InsuranceState.REFUNDED,
          txhash,
        });
        this.onContractStateChanged(id, InsuranceState.REFUNDED, txhash);
        break;
      case 4: // CANCEL
        break;
      case 5: // CLAIM
        this.logger.verbose('onContractStateChanged', {
          id,
          state: InsuranceState.CLAIMED,
          txhash,
        });
        this.onContractStateChanged(id, InsuranceState.CLAIMED, txhash);
        break;
      case 6: // EXPIRED
        break;
      case 7: // LIQUIDATED
        break;
      default:
        break;
    }
  }

  /**
   * Handles the event when a contract is created.
   * @param id - The ID of the contract.
   * @param address - The address of the contract.
   * @param unit - The unit of the contract.
   * @param margin - The margin of the contract.
   * @param txhash - The transaction hash of the contract.
   */
  private async onContractCreated(
    id: string,
    address: string,
    unit: string,
    margin: number,
    txhash: string,
  ) {
    let insurance: Insurance & { user: User };
    await this.insuranceHelper.lockInsurance(id, async () => {
      insurance = await this.prismaService.insurance.findUnique({
        where: { id },
        include: {
          user: true,
        },
      });
    });

    if (!insurance) {
      return;
    }

    this.updateTxhash(id, txhash);
    this.transactionService.create({
      amount: margin,
      insuranceId: insurance.id,
      status: TransactionStatus.SUCCESS,
      txhash,
      type: TransactionType.MARGIN,
      unit: insurance.unit,
      userId: insurance.userId,
    });

    if (insurance.state !== InsuranceState.PENDING) {
      this.logger.warn(`Insurance ${id} is not pending`);
      return;
    }

    let invalidReason;
    let payback = false;
    if (margin !== insurance.margin) {
      invalidReason = INVALID_REASONS.INVALID_MARGIN;
    } else if (insurance.user?.walletAddress !== address.toLowerCase()) {
      invalidReason = INVALID_REASONS.INVALID_WALLET_ADDRESS;
    } else if (dayjs().diff(insurance.createdAt, 'seconds') > 60) {
      invalidReason = INVALID_REASONS.CREATED_TIME_TIMEOUT;
      payback = true;
    } else if (insurance.unit !== unit) {
      invalidReason = INVALID_REASONS.INVALID_UNIT;
    }

    if (!!invalidReason) {
      this.invalidateInsurance(id, invalidReason, payback);
      return;
    }

    try {
      await this.availableInsurance(insurance);
    } catch (error) {
      this.logger.error('Error when availableInsurance: ' + error.message);
    }
  }

  private async onContractStateChanged(
    id: string,
    state: InsuranceState,
    txhash: string,
  ) {
    await this.insuranceHelper.lockInsurance(id, async () => {
      const updated = await this.prismaService.insurance.update({
        where: { id, state: { not: state } },
        data: {
          state,
          closedAt: new Date(),
        },
      });

      if (updated) {
        this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updated);
        this.addStateLog(id, {
          state,
          time: new Date(),
          txhash,
          error: null,
        });
      }
    });
  }

  async invalidateInsurance(
    id: string,
    invalidReason: string = '',
    payback = true,
  ) {
    this.logger.log(`Invalidate Insurance ${id}`);
    await this.insuranceHelper.lockInsurance(id, async () => {
      await this.prismaService.insurance.update({
        where: { id },
        data: {
          state: InsuranceState.INVALID,
          invalidReason,
          closedAt: new Date(),
        },
      });

      let hash: string;
      let error: string;
      if (payback) {
        try {
          const txn = await this.contract.updateInvalidInsurance(id);
          hash = txn.hash;
        } catch (e) {
          this.logger.error('Error when updateInvalidInsurance: ' + e.message);
          error = e.message;
        }
      }

      this.addStateLog(id, {
        state: InsuranceState.INVALID,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
  }

  async availableInsurance(insurance: Insurance) {
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      const symbol = `${insurance.asset}${insurance.unit}`;
      const currentPrice = await this.priceService.getFuturePrice(symbol);

      const {
        expiredAt,
        hedge,
        p_liquidation,
        q_claim,
        systemCapital,
        p_refund,
        leverage,
        p_cancel,
      } = this.insuranceHelper.calculateInsuranceParams({
        margin: insurance.margin,
        q_covered: insurance.q_covered,
        p_open: currentPrice,
        p_claim: insurance.p_claim,
        period: insurance.period,
        periodUnit: insurance.periodUnit,
        periodChangeRatio: insurance.periodChangeRatio,
      });

      const updated = await this.prismaService.insurance.update({
        where: { id: insurance.id, state: { not: InsuranceState.AVAILABLE } },
        data: {
          state: InsuranceState.AVAILABLE,
          p_open: currentPrice,
          p_liquidation,
          q_claim,
          systemCapital,
          p_refund,
          p_cancel,
          leverage,
          expiredAt,
          hedge,
        },
      });

      if (!updated) return;

      this.eventEmitter.emit(INSURANCE_EVENTS.CREATED, updated);
      //TODO: Transfer To Binance

      //End TODO

      let hash: string;
      let error: string;

      try {
        const txn = await this.contract.updateAvailableInsurance(
          insurance.id,
          parseEther(q_claim.toString()),
          dayjs(expiredAt).unix(),
        );
        hash = txn.hash;
      } catch (e) {
        this.logger.error(
          'Smart Contract updateAvailableInsurance Error: ' + e.message,
        );
        error = e.message;
      }

      this.addStateLog(insurance.id, {
        state: InsuranceState.AVAILABLE,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
  }

  async cancelInsurance(insurance: Insurance, p_close: number) {
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      updatedInsurance = await this.prismaService.insurance.update({
        where: { id: insurance.id, state: { not: InsuranceState.CANCELLED } },
        data: {
          state: InsuranceState.CANCELLED,
          p_close,
          closedAt: new Date(),
        },
      });
      if (!updatedInsurance) return;
      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      let hash: string;
      let error: string;
      try {
        const txn = await this.contract.cancel(insurance.id);
        hash = txn.hash;
      } catch (e) {
        this.logger.error('Error when cancelInsurance: ' + e.message);
        error = e.message;
      }

      this.transactionService.create({
        amount: insurance.margin,
        insuranceId: insurance.id,
        status: TransactionStatus.SUCCESS,
        txhash: hash,
        type: TransactionType.CANCEL,
        unit: insurance.unit,
        userId: insurance.userId,
      });

      this.addStateLog(insurance.id, {
        state: InsuranceState.CANCELLED,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
    return updatedInsurance;
  }

  public async claimInsurance(insurance: Insurance, currentPrice: number) {
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      const pnlUser = insurance.q_claim - insurance.margin;
      updatedInsurance = await this.prismaService.insurance.update({
        where: {
          id: insurance.id,
          state: { not: InsuranceState.CLAIM_WAITING },
        },
        data: {
          state: InsuranceState.CLAIM_WAITING,
          p_close: currentPrice,
          pnlUser,
          pnlProject: -pnlUser,
        },
      });
      if (!updatedInsurance) return;
      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      let hash: string;
      let error: string;
      try {
        const txn = await this.contract.claim(insurance.id);
        hash = txn.hash;
      } catch (e) {
        this.logger.error('Smart Contract claimInsurance Error: ' + e.message);
        error = e.message;
      }

      this.transactionService.create({
        amount: insurance.q_claim,
        insuranceId: insurance.id,
        status: TransactionStatus.SUCCESS,
        txhash: hash,
        type: TransactionType.CLAIM,
        unit: insurance.unit,
        userId: insurance.userId,
      });

      this.addStateLog(insurance.id, {
        state: InsuranceState.CLAIM_WAITING,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
    return updatedInsurance;
  }

  public async refundInsurance(insurance: Insurance, p_close: number) {
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      updatedInsurance = await this.prismaService.insurance.update({
        where: {
          id: insurance.id,
          state: { not: InsuranceState.REFUND_WAITING },
        },
        data: {
          state: InsuranceState.REFUND_WAITING,
          p_close,
          closedAt: new Date(),
        },
      });
      if (!updatedInsurance) return;
      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      let hash: string;
      let error: string;
      try {
        const txn = await this.contract.refund(insurance.id);
        hash = txn.hash;
      } catch (e) {
        this.logger.error('Smart Contract refundInsurance Error: ' + e.message);
        error = e.message;
      }

      this.transactionService.create({
        amount: insurance.margin,
        insuranceId: insurance.id,
        status: TransactionStatus.SUCCESS,
        txhash: hash,
        type: TransactionType.REFUND,
        unit: insurance.unit,
        userId: insurance.userId,
      });

      this.addStateLog(insurance.id, {
        state: InsuranceState.REFUND_WAITING,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
    return updatedInsurance;
  }

  public async liquidatedOrExpiredInsurance(
    insurance: Insurance,
    state: InsuranceState,
    p_close: number,
  ) {
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      const pnlUser = -insurance.margin;
      updatedInsurance = await this.prismaService.insurance.update({
        where: { id: insurance.id, state: { not: state } },
        data: {
          state,
          p_close,
          closedAt: new Date(),
          pnlUser,
          pnlProject: -pnlUser,
        },
      });

      if (!updatedInsurance) return;

      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      let hash: string;
      let error: string;
      try {
        switch (state) {
          case InsuranceState.LIQUIDATED:
            const txn = await this.contract.liquidate(insurance.id);
            hash = txn.hash;
            break;
          case InsuranceState.EXPIRED:
            const txn2 = await this.contract.expire(insurance.id);
            hash = txn2.hash;
            break;
        }
      } catch (e) {
        this.logger.error(
          'Smart Contract liquidatedOrExpiredInsurance Error: ' + e.message,
        );
        error = e.message;
      }

      this.addStateLog(insurance.id, {
        state,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
    return updatedInsurance;
  }

  private async updateTxhash(id: string, txhash: string) {
    try {
      await this.prismaService.insurance.update({
        where: { id },
        data: {
          txhash,
        },
      });
    } catch (error) {
      this.logger.error('Error when update txhash: ' + error.message);
    }
  }

  private async addStateLog(id: string, stateLog: StateLog) {
    this.logger.debug('addStateLog', { id, stateLog });
    const ins = await this.prismaService.insurance.update({
      where: { id },
      data: {
        stateLogs: {
          push: stateLog,
        },
      },
    });
    return ins;
  }

  async getInsuranceContract(id: string) {
    const results = await this.contract.readInsurance(id);
    const address = results[0]?.toLowerCase();
    if (!address || address === '0x0000000000000000000000000000000000000000')
      return null;
    return {
      address: results[0]?.toLowerCase(),
      unit: UnitContract[Number(results[1])],
      margin: parseFloat(formatEther(results[2])),
      q_claim: parseFloat(formatEther(results[3])),
      state: InsuranceContractState[Number(results[6])],
    };
  }

  //TODO: remove on production
  async createSampleInsurance(data: {
    id: string;
    margin: number;
    q_claim: number;
    expiredAt: Date;
  }) {
    const usdtContract = new Contract(
      '0x91532B1695E790546df949359118B5125672F790',
      USDT_ABI,
      this.modWallet,
    );

    try {
      const tn = await usdtContract.approve(
        await this.contract.getAddress(),
        parseEther('1000000'),
      );
      await tn.wait();

      const txn = await this.contract.createInsurance(
        data.id,
        UnitContract.USDT,
        parseEther(data.margin.toString()),
      );
      await txn.wait();

      console.log('txn', txn);
    } catch (error) {
      console.error('createSampleInsurance Error', error);
    }
  }

  async getStats() {
    //TODO: Get from smart contract

    return {};
  }
}
