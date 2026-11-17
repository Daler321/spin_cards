import { Injectable } from '@nestjs/common';
import type { ExchangeRate } from '../generated/prisma/client.js';
import type { PrismaService, Tx } from '../prisma/prisma.service.js';

@Injectable()
export class ExchangeRateService {
  /** Rate in effect now for from -> to, or null if the pair is not configured. */
  current(db: Tx | PrismaService, from: string, to: string): Promise<ExchangeRate | null> {
    return db.exchangeRate.findFirst({
      where: { fromCurrency: from, toCurrency: to, validFrom: { lte: new Date() } },
      orderBy: { validFrom: 'desc' },
    });
  }
}

const NANO = 1_000_000_000n;

/** Converts minor units of `from` into minor units of `to`, rounding down. */
export function convertMinor(
  amountMinor: bigint,
  rateNano: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  return (
    (amountMinor * rateNano * 10n ** BigInt(toDecimals)) / (NANO * 10n ** BigInt(fromDecimals))
  );
}

/** Fee in source minor units: max(minimum fee, ceil(amount × feeBp / 10 000)). */
export function conversionFee(amountMinor: bigint, feeBp: number, minFee: bigint): bigint {
  const proportional = (amountMinor * BigInt(feeBp) + 9999n) / 10_000n;
  return proportional > minFee ? proportional : minFee;
}
