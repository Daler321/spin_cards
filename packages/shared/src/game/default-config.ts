import type { GameConfig } from './config-schema.js';

/**
 * Default economy (TZ v1.1). This is data, not logic: it seeds `game_config_versions` (M2) and is
 * edited from the admin panel afterwards. Units: money in minor units, multipliers and chances in
 * basis points (10 000 = ×1.0 = 100%), durations in hours.
 *
 * base_limit ranges of paid packs are calibrated with the simulator to RTP ≈ 95% (TZ ranges gave
 * 61-290%, see docs/decisions.md D-024); everything else follows the TZ tables.
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  schemaVersion: 1,
  // Beta: 30 000 ₽ to start with (it used to be 5 000 and testers ran dry in the first hour).
  startingBalance: { RUB: 3_000_000 },
  conversion: {
    minAmount: { RUB: 10_000, USD: 100 },
    minFee: { RUB: 1000, USD: 12 },
    dailyLimit: { RUB: 500_000_000, USD: 5_500_000 },
  },
  // 300 levels; EXP for level n = 127.5 · (n − 1)^1.72, rounded to tens: about a month of active
  // play to the top (D-106).
  levels: Array.from({ length: 300 }, (_, i) => ({
    level: i + 1,
    exp: i === 0 ? 0 : Math.round((127.5 * i ** 1.72) / 10) * 10,
  })),
  holders: [
    // D-146, D-150: 4 free slots; more with holders, for money or Stars.
    { id: 'basic', slots: 4, unlockLevel: 1, prices: {}, starsPrice: null },
    {
      id: 'leather',
      slots: 5,
      unlockLevel: 10,
      prices: { RUB: 2_000_000, USD: 23_000 },
      starsPrice: 40,
    },
    {
      id: 'steel',
      slots: 10,
      unlockLevel: 50,
      prices: { RUB: 12_000_000, USD: 135_000 },
      starsPrice: 120,
    },
    {
      id: 'gold',
      slots: 20,
      unlockLevel: 120,
      prices: { RUB: 60_000_000, USD: 670_000 },
      starsPrice: 300,
    },
  ],
  tiers: {
    common: { designMultBp: 10_000, lifespanHours: 72, rarityPoints: 1, cardLuckPoints: 5 },
    rare: { designMultBp: 15_000, lifespanHours: 120, rarityPoints: 3, cardLuckPoints: 12 },
    epic: { designMultBp: 30_000, lifespanHours: 168, rarityPoints: 8, cardLuckPoints: 22 },
    legendary: {
      designMultBp: 80_000,
      lifespanHours: 240,
      rarityPoints: 25,
      cardLuckPoints: 32,
    },
    mythic: { designMultBp: 250_000, lifespanHours: 336, rarityPoints: 80, cardLuckPoints: 42 },
  },
  regions: {
    RU: {
      currency: 'RUB',
      banks: [
        { id: 'lemon', weight: 1 },
        { id: 'azure', weight: 1 },
        { id: 'ruby', weight: 1 },
        { id: 'emerald', weight: 1 },
      ],
    },
    US: {
      currency: 'USD',
      banks: [
        { id: 'liberty', weight: 1 },
        { id: 'eagle', weight: 1 },
        { id: 'evergreen', weight: 1 },
        { id: 'frontier', weight: 1 },
      ],
    },
  },
  packs: [
    {
      id: 'free',
      enabled: true,
      free: true,
      levelBaseLimitBonusBp: 30,
      prices: { RUB: 0, USD: 0 },
      starsPrice: null,
      baseLimit: { RUB: { min: 20_000, max: 60_000 }, USD: { min: 200, max: 700 } },
      unlockLevel: 1,
      exp: 1,
      tierWeights: { common: 8800, rare: 1000, epic: 180, legendary: 20, mythic: 0 },
      pity: { rare: 8, epic: 40, legendary: null },
    },
    {
      id: 'basic',
      levelBaseLimitBonusBp: 0,
      enabled: true,
      free: false,
      prices: { RUB: 100_000, USD: 1200 },
      starsPrice: null,
      baseLimit: { RUB: { min: 30_607, max: 90_922 }, USD: { min: 361, max: 1_080 } },
      unlockLevel: 1,
      exp: 10,
      tierWeights: { common: 8500, rare: 1200, epic: 280, legendary: 20, mythic: 0 },
      pity: { rare: 8, epic: 40, legendary: null },
    },
    {
      id: 'business',
      levelBaseLimitBonusBp: 0,
      enabled: true,
      free: false,
      // D-140: ×5 of Basic (was ×15), cards scaled with the price, open from level 10.
      prices: { RUB: 500_000, USD: 5600 },
      starsPrice: null,
      baseLimit: {
        RUB: { min: 159_570, max: 263_025 },
        USD: { min: 1_808, max: 2_917 },
      },
      unlockLevel: 10,
      exp: 30,
      tierWeights: { common: 5000, rare: 3500, epic: 1200, legendary: 280, mythic: 20 },
      pity: { rare: 8, epic: 40, legendary: 250 },
    },
    {
      id: 'premium',
      levelBaseLimitBonusBp: 0,
      enabled: true,
      free: false,
      // D-140: ×8 of Business (was ×6.7), cards scaled with the price, open from level 20.
      prices: { RUB: 4_000_000, USD: 44_000 },
      starsPrice: null,
      baseLimit: {
        RUB: { min: 726_221, max: 1_091_174 },
        USD: { min: 8_036, max: 12_055 },
      },
      unlockLevel: 20,
      exp: 90,
      tierWeights: { common: 1000, rare: 4500, epic: 3000, legendary: 1300, mythic: 200 },
      pity: { rare: 8, epic: 40, legendary: 250 },
    },
    {
      id: 'vip',
      levelBaseLimitBonusBp: 0,
      enabled: false,
      free: false,
      prices: {},
      starsPrice: 50,
      baseLimit: {
        RUB: { min: 4_000_000, max: 15_000_000 },
        USD: { min: 44_400, max: 166_700 },
      },
      unlockLevel: 1,
      exp: 200,
      tierWeights: { common: 0, rare: 0, epic: 6000, legendary: 3200, mythic: 800 },
      pity: { rare: null, epic: null, legendary: 250 },
    },
  ],
  patterns: {
    byId: {
      quad: { multBp: 25_000, rarityPoints: 2, weight: 1_500 },
      radar: { multBp: 20_000, rarityPoints: 1, weight: 3_000 },
      block_ladder: { multBp: 35_000, rarityPoints: 3, weight: 1_500 },
      long_ladder_5: { multBp: 50_000, rarityPoints: 5, weight: 800 },
      long_ladder_6: { multBp: 80_000, rarityPoints: 10, weight: 400 },
      long_ladder_7: { multBp: 150_000, rarityPoints: 20, weight: 150 },
      long_ladder_8: { multBp: 300_000, rarityPoints: 30, weight: 60 },
      long_ladder_9: { multBp: 600_000, rarityPoints: 45, weight: 20 },
      long_ladder_10: { multBp: 1_000_000, rarityPoints: 60, weight: 10 },
      tail_7777: { multBp: 120_000, rarityPoints: 40, weight: 50 },
      tail_0001: { multBp: 80_000, rarityPoints: 25, weight: 100 },
      tail_1337: { multBp: 80_000, rarityPoints: 25, weight: 100 },
      tail_6666: { multBp: 50_000, rarityPoints: 15, weight: 200 },
      tail_9999: { multBp: 50_000, rarityPoints: 15, weight: 200 },
      // D-148: nine kinds of full duplicates now (9 + 15 equal digits): the weights are ×10 so the
      // full duplicate keeps its old overall frequency.
      full_duplicate: { multBp: 1_000_000, rarityPoints: 500, weight: 1 },
    },
    noPatternWeight: 91_900,
    numberMultCapBp: 600_000,
  },
  luck: {
    meterMax: 30,
    luckyEpicPlusMultBp: 30_000,
    // D-141, D-147: players pay with their best card, so the corridor must hold at this cap
    // (maxPoints × pointBp: luck 100 is +70 % on Rare+ chances and beautiful numbers).
    boostCapBp: 7000,
    maxPoints: 100,
    pointBp: 70,
    badStreakLength: 6,
    badStreakMeterBonus: 5,
    returnAfterHours: 72,
    newbieScript: [
      { tier: 'rare' },
      { tier: 'common' },
      { tier: 'epic' },
      { boostBp: 1000 },
      { boostBp: 1000 },
    ],
    luckyFloor: 'rare',
    milestone: { everySpins: 500, floor: 'epic' },
    // D-116: below 30 000 ₽ / 350 $ Rare+ chances double (basic RTP ~103%); the first 20 spins
    // get ×4 (~112%).
    hidden: {
      lowBalanceBelow: { RUB: 3_000_000, USD: 35_000 },
      lowBalanceBoostBp: 10_000,
      newbieSpins: 20,
      newbieBoostBp: 30_000,
    },
  },
  freeSpins: { intervalHours: 4, maxStored: 3 },
  // D-129: 5 free album slots; 5 000 ₽ for a Common, ×√10 per tier (500 000 ₽ for a Mythic), plus 1%
  // per rarity point of the card up to ×3.
  // D-146: Telegram Stars. Buffs stack (no daily limit) under the common luck cap.
  stars: {
    // D-147: luck multipliers for an hour; ×20 takes even a Common card to the maximum.
    buffs: [
      { id: 'x1_5', multiplierBp: 15_000, minutes: 60, stars: 15 },
      { id: 'x3', multiplierBp: 30_000, minutes: 60, stars: 30 },
      { id: 'max', multiplierBp: 200_000, minutes: 60, stars: 60 },
    ],
    freeSpins: [
      { id: 'five', count: 5, stars: 15 },
      { id: 'twenty', count: 20, stars: 50 },
    ],
    cardLimitReset: 15,
    cardExtend: { common: 5, rare: 10, epic: 20, legendary: 35, mythic: 60 },
    trophy: { common: 10, rare: 25, epic: 50, legendary: 100, mythic: 200 },
    wheelNow: 10,
    // D-171: one tier up for Stars; the price grows with the tier.
    cardUpgrade: { common: 25, rare: 50, epic: 100, legendary: 250 },
  },
  showcase: {
    freeSlots: 5,
    price: {
      base: { RUB: 500_000, USD: 5500 },
      tierGrowthBp: 31_623,
      rarityPointBp: 100,
      rarityCapBp: 30_000,
    },
    extraSlotStars: 50,
  },
  cardSpinLimit: { spins: 500, windowHours: 12 },
  lifecycle: {
    graceHours: 72,
    // D-115: common 500 ₽, rare 2 000, epic 8 000, legendary 32 000, mythic 128 000 (+2% per rarity
    // point of the number, at most ×5), paid from the wallet.
    extendPrice: {
      base: { RUB: 50_000, USD: 600 },
      tierGrowthBp: 40_000,
      rarityPointBp: 200,
      rarityCapBp: 50_000,
    },
    extendLifespanBp: 5000,
    maxExtends: 1,
    restoreMultBp: 15_000,
    expiredCashoutFeeBp: 2000,
  },
  exp: {
    tierBonus: { common: 0, rare: 2, epic: 10, legendary: 30, mythic: 100 },
    dailyClaim: 20,
  },
  // D-125/D-132: two-week seasons. Score: rarity of dropped cards + 1 point per 1 000 ₽ of net worth
  // + 20 per level. The next season starts with 30 000 ₽ + 10 ₽ per point (up to +200 000 ₽).
  seasons: {
    lengthDays: 14,
    score: { rubPerPoint: 100_000, levelPoints: 20 },
    carryover: { perPoint: { RUB: 1000, USD: 11 }, cap: { RUB: 20_000_000, USD: 220_000 } },
    medals: [
      { maxRank: 1, achievementId: 'season_top1' },
      { maxRank: 3, achievementId: 'season_top3' },
      { maxRank: 10, achievementId: 'season_top10' },
      { maxRank: 50, achievementId: 'season_top50' },
    ],
  },
  // D-133: medals; season ones are earned again each season.
  achievements: [
    {
      id: 'first_epic',
      icon: '💜',
      kind: 'permanent',
      condition: { type: 'card_tier', tier: 'epic' },
      reward: { money: { RUB: 500000, USD: 5600 }, exp: 50 },
    },
    {
      id: 'first_legendary',
      icon: '🧡',
      kind: 'permanent',
      condition: { type: 'card_tier', tier: 'legendary' },
      reward: { money: { RUB: 2000000, USD: 22200 }, exp: 150 },
    },
    {
      id: 'first_mythic',
      icon: '🔥',
      kind: 'permanent',
      condition: { type: 'card_tier', tier: 'mythic' },
      reward: { money: { RUB: 10000000, USD: 111100 }, exp: 500 },
    },
    {
      id: 'full_duplicate',
      icon: '💎',
      kind: 'permanent',
      condition: { type: 'pattern', patterns: ['full_duplicate'] },
      reward: { money: { RUB: 50000000, USD: 555600 }, exp: 2000 },
    },
    {
      id: 'ladder_8',
      icon: '🪜',
      kind: 'permanent',
      condition: {
        type: 'pattern',
        patterns: ['long_ladder_8', 'long_ladder_9', 'long_ladder_10'],
      },
      reward: { money: { RUB: 10000000, USD: 111100 }, exp: 500 },
    },
    {
      id: 'lucky_7777',
      icon: '🍀',
      kind: 'permanent',
      condition: { type: 'pattern', patterns: ['tail_7777'] },
      reward: { money: { RUB: 5000000, USD: 55600 }, exp: 300 },
    },
    {
      id: 'spins_1000',
      icon: '🎰',
      kind: 'permanent',
      condition: { type: 'total_spins', value: 1000 },
      reward: { money: { RUB: 1000000, USD: 11100 }, exp: 100 },
    },
    {
      id: 'spins_10000',
      icon: '🏆',
      kind: 'permanent',
      condition: { type: 'total_spins', value: 10_000 },
      reward: { money: { RUB: 10000000, USD: 111100 }, exp: 1000 },
    },
    {
      id: 'level_50',
      icon: '⭐',
      kind: 'permanent',
      condition: { type: 'level', value: 50 },
      reward: { money: { RUB: 5000000, USD: 55600 } },
    },
    {
      id: 'millionaire',
      icon: '💰',
      kind: 'permanent',
      condition: { type: 'net_worth', value: 100_000_000 },
      reward: { money: { RUB: 5000000, USD: 55600 }, exp: 300 },
    },
    {
      id: 'trophies_5',
      icon: '🖼️',
      kind: 'permanent',
      condition: { type: 'trophies', value: 5 },
      reward: { money: { RUB: 2000000, USD: 22200 }, exp: 200 },
    },
    {
      id: 'quests_50',
      icon: '📜',
      kind: 'permanent',
      condition: { type: 'quests', value: 50 },
      reward: { money: { RUB: 3000000, USD: 33300 }, exp: 300 },
    },
    {
      id: 'season_top1',
      icon: '🥇',
      kind: 'season',
      condition: { type: 'season_rank' },
      reward: {},
    },
    {
      id: 'season_top3',
      icon: '🥈',
      kind: 'season',
      condition: { type: 'season_rank' },
      reward: {},
    },
    {
      id: 'season_top10',
      icon: '🥉',
      kind: 'season',
      condition: { type: 'season_rank' },
      reward: {},
    },
    {
      id: 'season_top50',
      icon: '🎖️',
      kind: 'season',
      condition: { type: 'season_rank' },
      reward: {},
    },
    {
      id: 'season_collection',
      icon: '📚',
      kind: 'season',
      condition: { type: 'season_collection' },
      reward: { money: { RUB: 10000000, USD: 111100 }, exp: 500 },
    },
  ],
  // D-124/D-127: five random daily quests a day from a wide pool (money grows with the level) and a
  // long season list in two steps, sized for an active player (~3 000 spins in two weeks).
  quests: {
    dailyCount: 5,
    daily: [
      {
        id: 'spins_50',
        metric: 'spins',
        target: 50,
        reward: { money: { RUB: 150000, USD: 1700 }, exp: 30 },
      },
      {
        id: 'spins_150',
        metric: 'spins',
        target: 150,
        minLevel: 5,
        reward: { money: { RUB: 300000, USD: 3300 }, exp: 60 },
      },
      {
        id: 'spins_300',
        metric: 'spins',
        target: 300,
        minLevel: 10,
        reward: { money: { RUB: 500000, USD: 5500 }, exp: 100 },
      },
      {
        id: 'spins_600',
        metric: 'spins',
        target: 600,
        minLevel: 20,
        reward: { money: { RUB: 900000, USD: 10000 }, exp: 160 },
      },
      {
        id: 'card_spins_30',
        metric: 'card_spins',
        target: 30,
        reward: { money: { RUB: 200000, USD: 2200 }, exp: 30 },
      },
      {
        id: 'card_spins_100',
        metric: 'card_spins',
        target: 100,
        minLevel: 8,
        reward: { money: { RUB: 450000, USD: 5000 }, exp: 80 },
      },
      {
        id: 'cashouts_15',
        metric: 'cashouts',
        target: 15,
        reward: { money: { RUB: 150000, USD: 1700 }, exp: 30 },
      },
      {
        id: 'cashouts_40',
        metric: 'cashouts',
        target: 40,
        minLevel: 8,
        reward: { money: { RUB: 350000, USD: 3900 }, exp: 60 },
      },
      {
        id: 'holds_2',
        metric: 'holds',
        target: 2,
        reward: { money: { RUB: 100000, USD: 1100 }, luck: { points: 5, spins: 10 } },
      },
      {
        id: 'holds_5',
        metric: 'holds',
        target: 5,
        minLevel: 5,
        reward: { money: { RUB: 250000, USD: 2800 }, exp: 40 },
      },
      {
        id: 'wheel_2',
        metric: 'wheel',
        target: 2,
        reward: { money: { RUB: 200000, USD: 2200 }, exp: 30 },
      },
      {
        id: 'wheel_3',
        metric: 'wheel',
        target: 3,
        minLevel: 5,
        reward: { money: { RUB: 350000, USD: 3900 }, exp: 50 },
      },
      {
        id: 'chest_1',
        metric: 'chest',
        target: 1,
        reward: { money: { RUB: 150000, USD: 1700 }, exp: 20 },
      },
      {
        id: 'chest_3',
        metric: 'chest',
        target: 3,
        minLevel: 10,
        reward: { money: { RUB: 400000, USD: 4400 }, exp: 60 },
      },
      {
        id: 'epic_3',
        metric: 'cards_tier',
        tier: 'epic',
        target: 3,
        reward: { money: { RUB: 250000, USD: 2800 }, exp: 40 },
      },
      {
        id: 'epic_8',
        metric: 'cards_tier',
        tier: 'epic',
        target: 8,
        minLevel: 10,
        reward: { money: { RUB: 500000, USD: 5500 }, exp: 80 },
      },
      {
        id: 'legendary_1',
        metric: 'cards_tier',
        tier: 'legendary',
        target: 1,
        minLevel: 10,
        reward: { money: { RUB: 500000, USD: 5500 }, exp: 80 },
      },
      {
        id: 'legendary_3',
        metric: 'cards_tier',
        tier: 'legendary',
        target: 3,
        minLevel: 25,
        reward: { money: { RUB: 1200000, USD: 13000 }, exp: 150 },
      },
      {
        id: 'mythic_1',
        metric: 'cards_tier',
        tier: 'mythic',
        target: 1,
        minLevel: 30,
        reward: { money: { RUB: 3000000, USD: 33000 }, exp: 300 },
      },
      {
        id: 'patterned_5',
        metric: 'cards_patterned',
        target: 5,
        reward: { money: { RUB: 200000, USD: 2200 }, exp: 30 },
      },
      {
        id: 'patterned_15',
        metric: 'cards_patterned',
        target: 15,
        minLevel: 10,
        reward: { money: { RUB: 500000, USD: 5500 }, exp: 80 },
      },
      {
        id: 'bank_30',
        metric: 'cards_bank_max',
        target: 30,
        minLevel: 5,
        reward: { money: { RUB: 300000, USD: 3300 }, exp: 50 },
      },
      {
        id: 'holder_3',
        metric: 'holder_size',
        target: 3,
        reward: { money: { RUB: 150000, USD: 1700 }, exp: 20 },
      },
      { id: 'daily_claim', metric: 'daily_claim', target: 1, reward: { freeSpins: 2, exp: 20 } },
    ],
    season: [
      {
        id: 'season_spins_1000',
        metric: 'spins',
        target: 1000,
        reward: { money: { RUB: 3000000, USD: 33000 }, exp: 500 },
      },
      {
        id: 'season_spins_3000',
        metric: 'spins',
        target: 3000,
        reward: { money: { RUB: 8000000, USD: 88000 }, exp: 1200 },
      },
      {
        id: 'season_spins_6000',
        metric: 'spins',
        target: 6000,
        reward: { money: { RUB: 16000000, USD: 176000 }, exp: 2500 },
      },
      {
        id: 'season_card_spins_1000',
        metric: 'card_spins',
        target: 1000,
        reward: { money: { RUB: 3000000, USD: 33000 }, exp: 500 },
      },
      {
        id: 'season_card_spins_3000',
        metric: 'card_spins',
        target: 3000,
        reward: { money: { RUB: 8000000, USD: 88000 }, exp: 1200 },
      },
      {
        id: 'season_cashouts_500',
        metric: 'cashouts',
        target: 500,
        reward: { money: { RUB: 2500000, USD: 27500 }, exp: 400 },
      },
      {
        id: 'season_cashouts_1500',
        metric: 'cashouts',
        target: 1500,
        reward: { money: { RUB: 7000000, USD: 77000 }, exp: 1000 },
      },
      {
        id: 'season_holds_50',
        metric: 'holds',
        target: 50,
        reward: { money: { RUB: 1500000, USD: 16500 }, exp: 250 },
      },
      {
        id: 'season_holds_150',
        metric: 'holds',
        target: 150,
        reward: { money: { RUB: 4000000, USD: 44000 }, exp: 600 },
      },
      {
        id: 'season_epic_100',
        metric: 'cards_tier',
        tier: 'epic',
        target: 100,
        reward: { money: { RUB: 4000000, USD: 44000 }, exp: 600 },
      },
      {
        id: 'season_epic_300',
        metric: 'cards_tier',
        tier: 'epic',
        target: 300,
        reward: { money: { RUB: 10000000, USD: 110000 }, exp: 1500 },
      },
      {
        id: 'season_legendary_15',
        metric: 'cards_tier',
        tier: 'legendary',
        target: 15,
        reward: { money: { RUB: 6000000, USD: 66000 }, luck: { points: 10, spins: 20 } },
      },
      {
        id: 'season_legendary_40',
        metric: 'cards_tier',
        tier: 'legendary',
        target: 40,
        reward: { money: { RUB: 15000000, USD: 165000 }, exp: 2000 },
      },
      {
        id: 'season_mythic_3',
        metric: 'cards_tier',
        tier: 'mythic',
        target: 3,
        reward: { money: { RUB: 15000000, USD: 165000 }, exp: 2000 },
      },
      {
        id: 'season_mythic_10',
        metric: 'cards_tier',
        tier: 'mythic',
        target: 10,
        reward: { money: { RUB: 40000000, USD: 440000 }, exp: 5000 },
      },
      {
        id: 'season_bank_300',
        metric: 'cards_bank_max',
        target: 300,
        reward: { money: { RUB: 4000000, USD: 44000 }, exp: 600 },
      },
      {
        id: 'season_bank_800',
        metric: 'cards_bank_max',
        target: 800,
        reward: { money: { RUB: 10000000, USD: 110000 }, exp: 1500 },
      },
      {
        id: 'season_patterned_150',
        metric: 'cards_patterned',
        target: 150,
        reward: { money: { RUB: 4000000, USD: 44000 }, exp: 600 },
      },
      {
        id: 'season_patterned_400',
        metric: 'cards_patterned',
        target: 400,
        reward: { money: { RUB: 10000000, USD: 110000 }, exp: 1500 },
      },
      {
        id: 'season_holder_5',
        metric: 'holder_size',
        target: 5,
        reward: { money: { RUB: 1500000, USD: 16500 }, exp: 200 },
      },
      {
        id: 'season_holder_10',
        metric: 'holder_size',
        target: 10,
        reward: { money: { RUB: 5000000, USD: 55000 }, exp: 700 },
      },
      {
        id: 'season_hold_96h',
        metric: 'hold_hours',
        target: 96,
        reward: { money: { RUB: 2000000, USD: 22000 }, exp: 300 },
      },
      {
        id: 'season_hold_240h',
        metric: 'hold_hours',
        target: 240,
        reward: { money: { RUB: 6000000, USD: 66000 }, exp: 800 },
      },
      {
        id: 'season_visits_7',
        metric: 'visit_days',
        target: 7,
        reward: { money: { RUB: 2000000, USD: 22000 }, freeSpins: 5 },
      },
      {
        id: 'season_visits_12',
        metric: 'visit_days',
        target: 12,
        reward: { money: { RUB: 5000000, USD: 55000 }, freeSpins: 15 },
      },
      {
        id: 'season_wheel_30',
        metric: 'wheel',
        target: 30,
        reward: { money: { RUB: 3000000, USD: 33000 }, luck: { points: 5, spins: 20 } },
      },
      {
        id: 'season_wheel_60',
        metric: 'wheel',
        target: 60,
        reward: { money: { RUB: 7000000, USD: 77000 }, exp: 800 },
      },
      {
        id: 'season_chest_30',
        metric: 'chest',
        target: 30,
        reward: { money: { RUB: 3000000, USD: 33000 }, exp: 400 },
      },
      {
        id: 'season_chest_80',
        metric: 'chest',
        target: 80,
        reward: { money: { RUB: 8000000, USD: 88000 }, exp: 1000 },
      },
      {
        id: 'season_daily_10',
        metric: 'daily_claim',
        target: 10,
        reward: { money: { RUB: 3000000, USD: 33000 }, freeSpins: 10 },
      },
    ],
    // D-157: 50 000 ₽ for joining the news channel, once a season.
    channel: { reward: { money: { RUB: 5000000, USD: 55000 } } },
    // D-158: friends who qualified this season; dollars in the same proportion as above.
    invite: {
      steps: [
        { friends: 10, reward: { money: { RUB: 10_000_000, USD: 110_000 } } },
        { friends: 20, reward: { money: { RUB: 25_000_000, USD: 275_000 } } },
        { friends: 40, reward: { money: { RUB: 99_900_000, USD: 1_098_900 } } },
      ],
    },
  },
  daily: {
    forgivenessWindowDays: 7,
    // D-113: the higher the level, the richer the daily reward.
    levelBonusBp: 400,
    levelStep: 25,
    rewards: [
      { money: { RUB: 50_000, USD: 600 } },
      { luck: { points: 5, spins: 10 } },
      { freeSpins: 2 },
      { money: { RUB: 100_000, USD: 1200 } },
      { guaranteedFloor: 'rare' },
      { money: { RUB: 150_000, USD: 1700 }, luck: { points: 10, spins: 10 } },
      { money: { RUB: 250_000, USD: 2800 }, guaranteedFloor: 'epic', chest: true },
    ],
  },
  rewardLevelBonusBp: 100,
  // One chest per 30 spins (D-107): rewards about three times the old 10-spin chest.
  chest: {
    everySpins: 30,
    maxStored: 5,
    levels: [
      {
        level: 1,
        upgradePrice: null,
        upgradeStarsPrice: null,
        rewards: [
          { weight: 40, money: { RUB: 100_000, USD: 1100 } },
          { weight: 25, money: { RUB: 250_000, USD: 2800 } },
          { weight: 20, luck: { points: 10, spins: 10 } },
          { weight: 10, freeSpins: 2 },
          { weight: 5, guaranteedFloor: 'rare' },
        ],
      },
      {
        level: 2,
        upgradePrice: { RUB: 5_000_000, USD: 56_000 },
        upgradeStarsPrice: 50,
        rewards: [
          { weight: 35, money: { RUB: 150_000, USD: 1700 } },
          { weight: 25, money: { RUB: 375_000, USD: 4200 } },
          { weight: 20, luck: { points: 15, spins: 10 } },
          { weight: 12, freeSpins: 3 },
          { weight: 8, guaranteedFloor: 'rare' },
        ],
      },
      {
        level: 3,
        upgradePrice: { RUB: 20_000_000, USD: 225_000 },
        upgradeStarsPrice: 150,
        rewards: [
          { weight: 32, money: { RUB: 220_000, USD: 2500 } },
          { weight: 25, money: { RUB: 550_000, USD: 6100 } },
          { weight: 18, luck: { points: 15, spins: 10 } },
          { weight: 15, freeSpins: 4 },
          { weight: 10, guaranteedFloor: 'epic' },
        ],
      },
      {
        level: 4,
        upgradePrice: { RUB: 80_000_000, USD: 900_000 },
        upgradeStarsPrice: 400,
        rewards: [
          { weight: 30, money: { RUB: 320_000, USD: 3600 } },
          { weight: 25, money: { RUB: 800_000, USD: 9000 } },
          { weight: 15, luck: { points: 15, spins: 10 } },
          { weight: 17, freeSpins: 5 },
          { weight: 13, guaranteedFloor: 'epic' },
        ],
      },
      {
        level: 5,
        upgradePrice: { RUB: 300_000_000, USD: 3_350_000 },
        upgradeStarsPrice: 1000,
        rewards: [
          { weight: 28, money: { RUB: 450_000, USD: 5000 } },
          { weight: 25, money: { RUB: 1_200_000, USD: 13_400 } },
          { weight: 15, luck: { points: 15, spins: 10 } },
          { weight: 17, freeSpins: 6 },
          { weight: 15, guaranteedFloor: 'legendary' },
        ],
      },
    ],
  },
  wheel: {
    intervalHours: 4,
    segments: [
      // D-178: money segments ×10 (owner's request).
      { id: 'money_s', weight: 30, money: { RUB: 200_000, USD: 2500 } },
      { id: 'buff_s', weight: 18, luck: { points: 5, spins: 10 } },
      { id: 'money_m', weight: 20, money: { RUB: 500_000, USD: 6000 } },
      { id: 'free_1', weight: 12, freeSpins: 1 },
      { id: 'money_l', weight: 6, money: { RUB: 1_500_000, USD: 17_000 } },
      { id: 'buff_m', weight: 8, luck: { points: 10, spins: 10 } },
      { id: 'free_2', weight: 5, freeSpins: 2 },
      { id: 'jackpot', weight: 1, money: { RUB: 10_000_000, USD: 112_000 } },
    ],
  },
  collectionLevels: [0, 25, 75, 150, 300, 600, 1200, 2500],
  transfer: { cardToCardFeeBp: 100 },
  // D-131: from level 3, 2% fee, up to 500 000 ₽ / 5 500 $ a day to send and to receive.
  p2p: {
    minLevel: 3,
    feeBp: 200,
    minAmount: { RUB: 10_000, USD: 100 },
    dailyLimit: { RUB: 50_000_000, USD: 550_000 },
  },
  notifications: {
    quietStartHour: 23,
    quietEndHour: 9,
    timezones: { RU: 'Europe/Moscow', US: 'America/New_York' },
    dailyLimit: 3,
    cardExpiringHours: 6,
    comebackAfterHours: 72,
    maxAttempts: 5,
    perSecond: 25,
  },
  // D-152: the beta's statistics start right after its fresh start (D-149), without the alpha.
  analytics: {
    timezone: 'Europe/Moscow',
    sessionGapMinutes: 30,
    since: '2026-10-16T19:05:05.000Z',
  },
  shop: {
    items: [{ id: 'free_spins_3', prices: { RUB: 150_000, USD: 1700 }, freeSpins: 3 }],
    // D-147: no luck buffs for game money any more (Stars multipliers only).
    buffs: [],
    buffDailyLimit: 3,
  },
  // D-108: the friend gets a welcome bonus; the referrer earns a share of the friend's spins.
  referral: {
    spinsRequired: 5,
    levelRequired: 2,
    // D-158: inviting pays: 30 000 ₽ to the referrer, 10 000 ₽ to the friend, no daily limit.
    referrerReward: { RUB: 3_000_000, USD: 33_000 },
    referredReward: { RUB: 1_000_000, USD: 11_000 },
    dailyLimit: 0,
    // D-119, D-158: 10 % of the friend's paid spins, at most 50 000 ₽ from one referred player
    // and 100 000 ₽ a day per referrer.
    commission: {
      shareBp: 1_000,
      days: 30,
      capPerReferral: { RUB: 5_000_000, USD: 55_000 },
      dailyCapPerReferrer: { RUB: 10_000_000, USD: 110_000 },
    },
  },
  antifraud: { spinsPerHour: 600, referralsPerDay: 5, sharedIpUsers: 4, p2pSendersPerDay: 3 },
  // D-147: a card's number adds 1 luck point per pattern rarity point, up to 45 (a card alone
  // never reaches 100: at most 42 + 45).
  cardLuck: { pointsPerPatternPoint: 1, numberCapPoints: 45 },
  pool: { redropChanceBp: 1500 },
  numberGeneration: { maxAttempts: 10 },
  nearMiss: {
    patternIds: [
      'quad',
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
    ],
  },
  cashout: { baseFeeBp: 1000, feeReductionPerLevelBp: 3, minFeeBp: 200 },
  // D-169: every game returns about 97 % (mines exactly, for any moment of taking the money; 21
  // with basic strategy about 99 %). Plinko: ×10 at the edges, ×0.1 in the middle.
  minigames: {
    maxBetShareBp: 3500,
    minBet: { RUB: 100, USD: 1 },
    mines: {
      houseEdgeBp: 300,
      bonusBp: 5000,
      difficulties: [
        { id: 'easy', cells: 12, minMines: 1, maxMines: 3 },
        { id: 'medium', cells: 24, minMines: 1, maxMines: 8 },
        { id: 'hard', cells: 48, minMines: 1, maxMines: 20 },
      ],
    },
    plinko: {
      maxBalls: 30,
      difficulties: [
        { id: 'easy', rows: 8, multipliersBp: mirror([1000, 6000, 16_000, 40_000, 100_000]) },
        {
          id: 'medium',
          rows: 12,
          multipliersBp: mirror([1000, 6000, 12_500, 23_000, 40_000, 60_000, 100_000]),
        },
        {
          id: 'hard',
          rows: 16,
          multipliersBp: mirror([
            1000, 5800, 11_000, 18_000, 27_000, 40_000, 55_000, 75_000, 100_000,
          ]),
        },
      ],
    },
    coinflip: { payoutBp: 19_400 },
    blackjack: { decks: 6, blackjackPayoutBp: 25_000 },
  },
  // D-170: the higher the tier, the lower the chance; the fee is set so that the new card is worth
  // about 97 % of it on average (the simulation checks the corridor).
  craft: {
    cards: 4,
    successBp: { common: 7000, rare: 5500, epic: 4000, legendary: 2500 },
    fee: {
      common: { RUB: 180_000, USD: 2050 },
      rare: { RUB: 310_000, USD: 3500 },
      epic: { RUB: 690_000, USD: 7600 },
      legendary: { RUB: 1_650_000, USD: 18_400 },
    },
    baseLimit: { RUB: { min: 50_000, max: 150_000 }, USD: { min: 550, max: 1700 } },
  },
  // D-172: about 1 % of the album price of a trophy of the tier every 8 hours.
  albumIncome: {
    intervalHours: 8,
    perTier: {
      common: { RUB: 5000, USD: 55 },
      rare: { RUB: 15_000, USD: 170 },
      epic: { RUB: 50_000, USD: 550 },
      legendary: { RUB: 150_000, USD: 1700 },
      mythic: { RUB: 500_000, USD: 5500 },
    },
  },
  // D-173: the bot's tag in the Telegram name (an ad for the game).
  nickBonus: {
    tag: '@SpinCards_bot',
    checkHours: 4,
    claimHours: 24,
    // D-178: 30 000 ₽ (not scaled by level), 4 free spins, the next spin Epic or better.
    reward: { money: { RUB: 3_000_000, USD: 33_300 }, freeSpins: 4, guaranteedFloor: 'epic' },
  },
  links: { newsUrl: 'https://t.me/SpinCards_game' },
  simulation: { rtpCorridor: { minBp: 8500, maxBp: 11_000 }, bestCardLevel: 100 },
  safeguards: {
    dailyEmission: { RUB: 10_000_000_000, USD: 110_000_000 },
    rtp: { windowMinutes: 60, minSpins: 500, minBp: 5000, maxBp: 15_000, autoPause: true },
  },
};

/** Plinko cups from the middle outwards → the whole symmetric row. */
function mirror(fromMiddle: number[]): number[] {
  return [...fromMiddle.slice(1).reverse(), ...fromMiddle];
}
