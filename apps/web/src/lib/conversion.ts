import type { Currency, PublicConfigResponse } from '@spincards/shared';

export interface ConversionPreview {
  fee: number;
  result: number;
  /** Units of `to` per one unit of `from`, for display. */
  rate: number;
  belowMinimum: boolean;
}

/** Same formula as the api (D-043): fee in the source currency, result rounded down. */
export function previewConversion(
  config: PublicConfigResponse,
  from: Currency,
  to: Currency,
  amount: number,
): ConversionPreview | null {
  const rate = config.conversion.rates.find((r) => r.fromCurrency === from && r.toCurrency === to);
  if (!rate) return null;
  const rateNano = BigInt(rate.rateNano);
  const minFee = BigInt(config.conversion.minFee[from]);
  const big = BigInt(amount);
  const proportional = (big * BigInt(rate.feeBp) + 9999n) / 10_000n;
  const fee = proportional > minFee ? proportional : minFee;
  const result = big > fee ? ((big - fee) * rateNano) / 1_000_000_000n : 0n;
  return {
    fee: Number(fee),
    result: Number(result),
    rate: Number(rateNano) / 1e9,
    belowMinimum: amount < config.conversion.minAmount[from] || result <= 0n,
  };
}
