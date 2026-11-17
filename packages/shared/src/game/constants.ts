/** Structural game vocabulary. Economy numbers never live here, only in GameConfig. */

export const TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Tier = (typeof TIERS)[number];

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** D-170/D-171: tiers that can be crafted or upgraded one step up (Mythic is the top). */
export const UPGRADE_TIERS = [
  'common',
  'rare',
  'epic',
  'legendary',
] as const satisfies readonly Tier[];
export type UpgradeTier = (typeof UPGRADE_TIERS)[number];

/** The tier one step up, or null for the top one. */
export function nextTier(tier: Tier): Tier | null {
  return TIERS[tierRank(tier) + 1] ?? null;
}

export function isUpgradeTier(tier: Tier): tier is UpgradeTier {
  return (UPGRADE_TIERS as readonly Tier[]).includes(tier);
}

export const REGIONS = ['RU', 'US'] as const;
/** Everybody starts here, in rubles; dollars are one switch away (D-156). */
export const DEFAULT_REGION = 'RU';
export type Region = (typeof REGIONS)[number];

export const CURRENCIES = ['RUB', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Tier floors a pity guarantee can enforce ("Rare+", "Epic+", "Legendary+"). */
export const PITY_FLOORS = ['rare', 'epic', 'legendary'] as const satisfies readonly Tier[];
export type PityFloor = (typeof PITY_FLOORS)[number];

/**
 * D-168: card face designs. A season picks one (`seasons.design_set_id`, empty = the latest); a
 * trophy keeps the design it was put into the album with, so the album shows every season's look.
 */
export const CARD_DESIGNS = ['classic', 'emerald'] as const;
export type CardDesign = (typeof CARD_DESIGNS)[number];
/** The original look: trophies kept before D-168 have no design stored. */
export const DEFAULT_CARD_DESIGN: CardDesign = 'classic';
/** Seasons without a design of their own get the newest one. */
export const LATEST_CARD_DESIGN: CardDesign = 'emerald';

function knownDesign(id: string | null | undefined): CardDesign | undefined {
  return CARD_DESIGNS.find((d) => d === id);
}

/** The design of a season (unknown or empty id: the latest). */
export function seasonCardDesign(designSetId: string | null | undefined): CardDesign {
  return knownDesign(designSetId) ?? LATEST_CARD_DESIGN;
}

/** The design stored on a trophy (unknown or empty id: the original look). */
export function trophyCardDesign(design: string | null | undefined): CardDesign {
  return knownDesign(design) ?? DEFAULT_CARD_DESIGN;
}

export const CARD_NUMBER_LENGTH = 16;
export const CARD_BLOCK_LENGTH = 4;
/** Every game card number starts with 9: no real payment system uses it. */
export const CARD_NUMBER_PREFIX_DIGIT = 9;

export const LONG_LADDER_MIN = 5;
export const LONG_LADDER_MAX = 10;

export const TAIL_PATTERNS = {
  tail_7777: '7777',
  tail_0001: '0001',
  tail_1337: '1337',
  tail_6666: '6666',
  tail_9999: '9999',
} as const;
export type TailPatternId = keyof typeof TAIL_PATTERNS;

export const PATTERN_IDS = [
  'quad',
  'radar',
  'block_ladder',
  'long_ladder_5',
  'long_ladder_6',
  'long_ladder_7',
  'long_ladder_8',
  'long_ladder_9',
  'long_ladder_10',
  'tail_7777',
  'tail_0001',
  'tail_1337',
  'tail_6666',
  'tail_9999',
  'full_duplicate',
] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

export function longLadderId(length: number): PatternId {
  const id = `long_ladder_${length}`;
  if (!(PATTERN_IDS as readonly string[]).includes(id)) {
    throw new RangeError(`no long ladder pattern of length ${length}`);
  }
  return id as PatternId;
}

/**
 * What a quest counts (D-124). Snapshot metrics (`holder_size`, `hold_hours`) are measured from the
 * holder; the rest add up actions.
 */
export const QUEST_METRICS = [
  'spins',
  'card_spins',
  'cards_tier',
  'cards_bank_max',
  'cards_patterned',
  'cashouts',
  'holds',
  'wheel',
  'chest',
  'daily_claim',
  'visit_days',
  'holder_size',
  'hold_hours',
] as const;
export type QuestMetric = (typeof QUEST_METRICS)[number];
export const QUEST_KINDS = ['daily', 'season'] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

/** Quests follow Moscow days (UTC+3, no DST): a new set of daily quests at 00:00 MSK. */
const QUEST_DAY_OFFSET_MS = 3 * 3600_000;

export function questDay(now: Date): string {
  return new Date(now.getTime() + QUEST_DAY_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextQuestReset(now: Date): Date {
  const shifted = new Date(now.getTime() + QUEST_DAY_OFFSET_MS);
  shifted.setUTCHours(24, 0, 0, 0);
  return new Date(shifted.getTime() - QUEST_DAY_OFFSET_MS);
}

/** The free holder every player has (D-150): counted even without a user_holders row. */
export const STARTER_HOLDER_ID = 'basic';

/** D-169: mini-games and their difficulty levels (mines field size, plinko rows). */
export const MINIGAMES = ['mines', 'plinko', 'coinflip', 'blackjack'] as const;
export type MiniGameId = (typeof MINIGAMES)[number];
export const MINIGAME_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type MiniGameDifficulty = (typeof MINIGAME_DIFFICULTIES)[number];
