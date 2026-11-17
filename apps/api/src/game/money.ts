import { BP } from '@spincards/game-core';

/** balance × (1 − fee), rounded down, in minor units. */
export function payoutOf(balance: bigint, feeBp: number): bigint {
  return (balance * BigInt(BP - feeBp)) / BigInt(BP);
}
