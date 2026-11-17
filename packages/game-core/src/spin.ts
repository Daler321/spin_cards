import {
  type Currency,
  type GameConfig,
  type LuckySource,
  luckySource,
  type PackConfig,
  type PatternId,
  type PityFloor,
  type Region,
  type Tier,
  tierRank,
  TIERS,
} from '@spincards/shared';
import {
  luckBoostBp,
  luckPoints,
  consumeBuffs,
  duePityFloor,
  nextMeter,
  nextSinceFloor,
  type PackCounters,
  type PlayerCounters,
} from './luck/state.js';
import { effectiveTierWeights, hiddenBoostBp, weightsFromFloor } from './luck/tier-weights.js';
import { BP, mulDivFloor, pickWeighted, rollChance } from './math.js';
import { findNearMiss, type NearMiss } from './near-miss.js';
import { toDigits } from './number/digits.js';
import { generateNumber } from './number/generate.js';
import { findPatterns, type PatternMatch } from './number/patterns.js';
import type { CardPool, Rng, UniquenessChecker } from './ports.js';
import { cardBalance, cardLuckPoints, numberMultBp, rarityScore } from './valuation.js';

/** D-147: a card pays with its luck points. */
export type SpinPayment = { type: 'wallet' } | { type: 'card'; luckPoints: number };

export interface SpinInput {
  config: GameConfig;
  packId: string;
  region: Region;
  payment: SpinPayment;
  player: PlayerCounters;
  pack: PackCounters;
  /** One-off guarantee (e.g. the 7th daily reward): the spin lands at or above this tier. */
  guaranteedFloor?: Tier | null;
  /** Player level: packs with levelBaseLimitBonusBp give bigger cards to higher levels. */
  playerLevel?: number;
  /** Wallet plus active cards in the spin currency, before paying (D-116); unknown: no boost. */
  totalBalance?: number;
}

export interface SpinPorts {
  rng: Rng;
  uniqueness: UniquenessChecker;
  pool: CardPool;
}

export interface SpinCard {
  source: 'new' | 'pool';
  poolCardId: string | null;
  number: string;
  bankId: string;
  region: Region;
  currency: Currency;
  tier: Tier;
  patterns: PatternMatch[];
  baseLimit: number;
  designMultBp: number;
  numberMultBp: number;
  balance: number;
  rarityScore: number;
  /** D-147: luck points this card gives when it pays. */
  luckPoints: number;
  lifespanHours: number;
  ownersCount: number;
}

export type { LuckySource } from '@spincards/shared';

export interface SpinResult {
  card: SpinCard;
  nearMiss: NearMiss | null;
  lucky: LuckySource | null;
  pityApplied: PityFloor | null;
  /** True when the caller's guaranteedFloor decided the tier. */
  guaranteeApplied: boolean;
  /** 0-based step of the newbie script that shaped this spin, or null. */
  newbieStep: number | null;
  /** Inputs of the roll, stored with the spin for audit (`spins.rolled_params`). */
  rolled: {
    tierWeights: Record<Tier, number>;
    /** D-147: the luck (0..maxPoints) the spin was played with. */
    luckPoints: number;
    rarePlusBoostBp: number;
    hiddenBoostBp: number;
    patternTarget: PatternId | null;
  };
  player: PlayerCounters;
  pack: PackCounters;
}

export class SpinRejectedError extends Error {
  constructor(readonly reason: 'PACK_NOT_FOUND' | 'PACK_DISABLED' | 'PACK_NOT_SOLD') {
    super(reason);
  }
}

/**
 * Resolves a spin completely before any animation (TZ 5.6 steps 2-7). Charging the price
 * (step 1) and persisting the result belong to the caller.
 */
export async function resolveSpin(input: SpinInput, ports: SpinPorts): Promise<SpinResult> {
  const { config, region, payment, player, pack: counters } = input;
  const pack = findPack(config, input.packId);
  const currency = config.regions[region].currency;
  const price = pack.free ? 0 : pack.prices[currency];
  if (price === undefined) throw new SpinRejectedError('PACK_NOT_SOLD');

  // Step 2: effective weights.
  // A milestone spin (every N-th of the player) beats the meter, which beats the return bonus.
  const lucky = luckySource({
    totalSpins: player.totalSpins,
    meter: counters.luckMeter,
    meterMax: config.luck.meterMax,
    everySpins: config.luck.milestone.everySpins,
    freePack: pack.free,
    returnPending: player.returnLuckyPending,
  });
  const newbieStep = player.totalSpins < config.luck.newbieScript.length ? player.totalSpins : null;
  const newbie = newbieStep === null ? undefined : config.luck.newbieScript[newbieStep];
  // D-147: one luck number (card + free bonuses, × a Stars multiplier) drives both Rare+ chances
  // and beautiful numbers; the newbie script's hidden boost comes on top.
  const luck = luckPoints(payment.type === 'card' ? payment.luckPoints : 0, player.buffs, config);
  const luckBp = luckBoostBp(luck, config);
  const rarePlusBoostBp = luckBp + (newbie && 'boostBp' in newbie ? newbie.boostBp : 0);
  const hiddenBp = hiddenBoostBp(config, player.totalSpins, currency, input.totalBalance);
  const tierWeights = effectiveTierWeights(
    pack.tierWeights,
    { lucky: lucky !== null, rarePlusBoostBp, hiddenBoostBp: hiddenBp },
    config,
  );

  // Steps 3-4: guarantees and the newbie script take priority over chance; the highest floor wins.
  const pityFloor = duePityFloor(pack, counters);
  const guarantee = input.guaranteedFloor ?? null;
  const luckyFloor: Tier | null =
    lucky === 'milestone' ? config.luck.milestone.floor : lucky ? config.luck.luckyFloor : null;
  const floor = [guarantee, pityFloor, luckyFloor].reduce<Tier | null>(
    (best, t) => (t && (!best || tierRank(t) > tierRank(best)) ? t : best),
    null,
  );
  const scripted = newbie && 'tier' in newbie ? newbie.tier : null;
  let tier: Tier;
  let pityApplied: PityFloor | null = null;
  let guaranteeApplied = false;
  if (floor && (!scripted || tierRank(scripted) < tierRank(floor))) {
    tier = pickWeighted(ports.rng, weightsFromFloor(tierWeights, floor));
    if (floor === guarantee) guaranteeApplied = true;
    else if (floor === pityFloor) pityApplied = pityFloor;
  } else if (scripted) {
    tier = scripted;
  } else {
    tier = pickWeighted(
      ports.rng,
      TIERS.map((t): [Tier, number] => [t, tierWeights[t]]),
    );
  }

  const bankId = pickWeighted(
    ports.rng,
    config.regions[region].banks.map((bank): [string, number] => [bank.id, bank.weight]),
  );
  const range = pack.baseLimit[currency];
  const levelBonusBp = Math.max(0, (input.playerLevel ?? 1) - 1) * pack.levelBaseLimitBonusBp;
  const baseLimit = mulDivFloor(ports.rng.int(range.min, range.max + 1), BP + levelBonusBp, BP);

  // Step 5: a pooled card of this tier, or a freshly generated number.
  const pooled = rollChance(ports.rng, config.pool.redropChanceBp)
    ? await ports.pool.takeOldest(tier, region)
    : null;
  let number: string;
  let patterns: PatternMatch[];
  let patternTarget: PatternId | null = null;
  if (pooled) {
    number = pooled.number;
    patterns = findPatterns(toDigits(number), config.patterns.byId);
  } else {
    const built = await generateNumber(ports.rng, ports.uniqueness, config, luckBp, {
      bankId,
      tier,
    });
    ({ number, patterns } = built);
    patternTarget = built.target;
  }
  if (patterns.some((p) => p.id === 'full_duplicate')) tier = 'mythic';

  // Step 6: value the card.
  const designMultBp = config.tiers[tier].designMultBp;
  const numberMult = numberMultBp(patterns, config);
  const balance = cardBalance(baseLimit, designMultBp, numberMult);
  const rarity = rarityScore(tier, patterns, config);

  // Step 7: counters.
  const meter = nextMeter(counters, lucky === 'meter', price > 0 ? balance < price : null, config);

  return {
    card: {
      source: pooled ? 'pool' : 'new',
      poolCardId: pooled?.id ?? null,
      number,
      bankId: pooled?.bankId ?? bankId,
      region,
      currency,
      tier,
      patterns,
      baseLimit,
      designMultBp,
      numberMultBp: numberMult,
      balance,
      rarityScore: rarity,
      luckPoints: cardLuckPoints(tier, patterns, config),
      lifespanHours: config.tiers[tier].lifespanHours,
      ownersCount: (pooled?.ownersCount ?? 0) + 1,
    },
    nearMiss: findNearMiss(toDigits(number), patterns, config),
    lucky,
    pityApplied,
    guaranteeApplied,
    newbieStep,
    rolled: {
      tierWeights,
      luckPoints: luck,
      rarePlusBoostBp,
      hiddenBoostBp: hiddenBp,
      patternTarget,
    },
    player: {
      totalSpins: player.totalSpins + 1,
      returnLuckyPending: lucky === 'return' ? false : player.returnLuckyPending,
      buffs: consumeBuffs(player.buffs),
    },
    pack: { ...meter, sinceFloor: nextSinceFloor(counters.sinceFloor, tier) },
  };
}

function findPack(config: GameConfig, packId: string): PackConfig {
  const pack = config.packs.find((p) => p.id === packId);
  if (!pack) throw new SpinRejectedError('PACK_NOT_FOUND');
  if (!pack.enabled) throw new SpinRejectedError('PACK_DISABLED');
  return pack;
}
