/** Money crosses the API as integer minor units; all game values stay far below 2^53. */
export function toApiMoney(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('money value exceeds the safe integer range');
  }
  return Number(value);
}
