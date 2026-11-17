import { BP, mulDivFloor } from '../math.js';

/**
 * Applies multiplicative boosts to the `boosted` entries, then limits the total added weight to
 * capBp of their original sum (scaling every boost proportionally). Untouched entries keep their
 * weight, so normalisation happens implicitly when picking.
 */
export function capBoost<K extends string>(
  base: Readonly<Record<K, number>>,
  boosted: Record<K, number>,
  keys: readonly NoInfer<K>[],
  capBp: number,
): Record<K, number> {
  let added = 0;
  let baseSum = 0;
  for (const key of keys) {
    added += boosted[key] - base[key];
    baseSum += base[key];
  }
  const allowed = mulDivFloor(baseSum, capBp, BP);
  if (added <= allowed) return boosted;

  const capped = { ...boosted };
  for (const key of keys) {
    capped[key] = base[key] + mulDivFloor(boosted[key] - base[key], allowed, added);
  }
  return capped;
}
