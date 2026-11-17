import {
  type Currency,
  CURRENCIES,
  type GameConfig,
  nextTier,
  type Region,
  REGIONS,
  type Tier,
  UPGRADE_TIERS,
  type UpgradeTier,
} from '@spincards/shared';
import { BP, mulDivFloor, pickWeighted, rollChance } from './math.js';
import { generateNumber } from './number/generate.js';
import type { PatternMatch } from './number/patterns.js';
import type { Rng, UniquenessChecker } from './ports.js';
import { cardBalance, cardLuckPoints, numberMultBp, rarityScore } from './valuation.js';

/** A card made outside a spin (D-170): a fresh number of a given tier, valued like a dropped one. */
export interface ForgedCard {
  number: string;
  bankId: string;
  region: Region;
  currency: Currency;
  tier: Tier;
  patterns: PatternMatch[];
  baseLimit: number;
  numberMultBp: number;
  balance: number;
  rarityScore: number;
  luckPoints: number;
  lifespanHours: number;
}

export interface ForgePorts {
  rng: Rng;
  uniqueness: UniquenessChecker;
}

/** A new card of `tier` in the region; a full duplicate still makes it Mythic, as in a spin. */
export async function forgeCard(
  config: GameConfig,
  region: Region,
  tier: Tier,
  baseLimit: number,
  ports: ForgePorts,
): Promise<ForgedCard> {
  const bankId = pickWeighted(
    ports.rng,
    config.regions[region].banks.map((bank): [string, number] => [bank.id, bank.weight]),
  );
  const built = await generateNumber(ports.rng, ports.uniqueness, config, 0, { bankId, tier });
  const finalTier: Tier = built.patterns.some((p) => p.id === 'full_duplicate') ? 'mythic' : tier;
  const numberMult = numberMultBp(built.patterns, config);
  return {
    number: built.number,
    bankId,
    region,
    currency: config.regions[region].currency,
    tier: finalTier,
    patterns: built.patterns,
    baseLimit,
    numberMultBp: numberMult,
    balance: cardBalance(baseLimit, config.tiers[finalTier].designMultBp, numberMult),
    rarityScore: rarityScore(finalTier, built.patterns, config),
    luckPoints: cardLuckPoints(finalTier, built.patterns, config),
    lifespanHours: config.tiers[finalTier].lifespanHours,
  };
}

export interface CraftOutcome {
  success: boolean;
  card: ForgedCard;
}

/**
 * D-170: crafting cards of `tier`: with successBp the new card is one tier up, otherwise the same
 * tier. The chance is decided first, then the card is forged.
 */
export async function resolveCraft(
  config: GameConfig,
  craft: NonNullable<GameConfig['craft']>,
  region: Region,
  tier: UpgradeTier,
  ports: ForgePorts,
): Promise<CraftOutcome> {
  const success = rollChance(ports.rng, craft.successBp[tier]);
  const range = craft.baseLimit[config.regions[region].currency];
  const baseLimit = ports.rng.int(range.min, range.max + 1);
  const target = success ? (nextTier(tier) ?? tier) : tier;
  return { success, card: await forgeCard(config, region, target, baseLimit, ports) };
}

/**
 * D-170: for the config check, the average balance of the crafted card against the craft fee, per
 * input tier and currency (`samples` crafts each, numbers never collide).
 */
export async function craftReturns(
  config: GameConfig,
  rng: Rng,
  samples: number,
): Promise<{ tier: UpgradeTier; currency: Currency; returnBp: number }[]> {
  const craft = config.craft;
  if (!craft) return [];
  const free: UniquenessChecker = { isNumberFree: () => Promise.resolve(true) };
  const out: { tier: UpgradeTier; currency: Currency; returnBp: number }[] = [];
  for (const currency of CURRENCIES) {
    const region = REGIONS.find((r) => config.regions[r].currency === currency);
    if (!region) continue;
    for (const tier of UPGRADE_TIERS) {
      let total = 0;
      for (let i = 0; i < samples; i++)
        total += (await resolveCraft(config, craft, region, tier, { rng, uniqueness: free })).card
          .balance;
      const fee = craft.fee[tier][currency];
      out.push({
        tier,
        currency,
        returnBp: fee > 0 ? mulDivFloor(Math.round(total / samples), BP, fee) : 0,
      });
    }
  }
  return out;
}
