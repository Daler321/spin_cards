import { HttpStatus, Injectable } from '@nestjs/common';
import { type Currency, ErrorCode, type GameConfig } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, LedgerService } from '../ledger/ledger.service.js';
import type { Tx } from '../prisma/prisma.service.js';
import { conversionFee, convertMinor, ExchangeRateService } from './exchange-rate.service.js';
import type { ConvertResponse } from '@spincards/shared';

export interface ConvertRequest {
  from: Currency;
  to: Currency;
  amount: number;
  idempotencyKey: string;
}

@Injectable()
export class ConversionService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly rates: ExchangeRateService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
  ) {}

  async convert(userId: string, request: ConvertRequest): Promise<ConvertResponse> {
    const { idempotencyKey, ...payload } = request;
    // Loaded before the transaction: no shared-pool queries while holding a transaction connection.
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'wallet.convert', payload },
      (tx) => this.execute(tx, userId, payload, config, seasonId),
    );
  }

  private async execute(
    tx: Tx,
    userId: string,
    { from, to, amount: amountNumber }: Omit<ConvertRequest, 'idempotencyKey'>,
    config: GameConfig,
    seasonId: string,
  ): Promise<ConvertResponse> {
    if (from === to) throw new AppError(ErrorCode.VALIDATION_FAILED);
    const amount = BigInt(amountNumber);

    const [fromCurrency, toCurrency, rate] = await Promise.all([
      tx.currency.findUnique({ where: { code: from } }),
      tx.currency.findUnique({ where: { code: to } }),
      this.rates.current(tx, from, to),
    ]);
    if (!fromCurrency?.isActive || !toCurrency?.isActive || !rate) {
      throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED);
    }
    const wallets = await tx.wallet.findMany({ where: { userId, currency: { in: [from, to] } } });
    const source = wallets.find((w) => w.currency === from);
    const target = wallets.find((w) => w.currency === to);
    if (!source || !target) throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED);

    const fee = conversionFee(amount, rate.feeBp, BigInt(config.conversion.minFee[from]));
    const amountTo = convertMinor(
      amount - fee,
      rate.rateNano,
      fromCurrency.decimals,
      toCurrency.decimals,
    );
    if (amount < BigInt(config.conversion.minAmount[from]) || amountTo <= 0n) {
      throw new AppError(ErrorCode.CONVERSION_BELOW_MINIMUM);
    }

    // Lock the source wallet first so the daily-limit check cannot race with another conversion.
    const sourceRef = { type: LedgerAccountType.wallet, id: source.id };
    const targetRef = { type: LedgerAccountType.wallet, id: target.id };
    await this.ledger.lock(tx, [sourceRef, targetRef]);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const today = await tx.currencyConversion.aggregate({
      where: { userId, fromCurrency: from, createdAt: { gte: dayStart } },
      _sum: { amountFrom: true },
    });
    if ((today._sum.amountFrom ?? 0n) + amount > BigInt(config.conversion.dailyLimit[from])) {
      throw new AppError(ErrorCode.CONVERSION_LIMIT_EXCEEDED, HttpStatus.CONFLICT);
    }

    const conversion = await tx.currencyConversion.create({
      data: {
        userId,
        fromCurrency: from,
        toCurrency: to,
        amountFrom: amount,
        fee,
        amountTo,
        rateNano: rate.rateNano,
        rateId: rate.id,
      },
    });
    const ref = { type: 'conversion', id: conversion.id };
    const balances = await this.ledger.post(
      tx,
      [
        { account: sourceRef, delta: -amount, reason: LedgerReason.convert_out, ref },
        { account: targetRef, delta: amountTo, reason: LedgerReason.convert_in, ref },
      ],
      { seasonId },
    );

    return {
      conversionId: conversion.id,
      from,
      to,
      amountFrom: toApiMoney(amount),
      fee: toApiMoney(fee),
      amountTo: toApiMoney(amountTo),
      wallets: [
        { currency: from, balance: toApiMoney(balances.get(accountKey(sourceRef)) ?? 0n) },
        { currency: to, balance: toApiMoney(balances.get(accountKey(targetRef)) ?? 0n) },
      ],
    };
  }
}
