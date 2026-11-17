import { z } from 'zod';
import {
  PATTERN_IDS,
  CURRENCIES,
  type Tier,
  TIERS,
  QUEST_METRICS,
  REGIONS,
  MINIGAME_DIFFICULTIES,
  UPGRADE_TIERS,
  type UpgradeTier,
} from './constants.js';

/** Basis points: 10 000 = 100% = ×1.0. */
const bp = z.number().int().nonnegative();
/** Money in minor units (kopecks, cents). */
const money = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

function perTier<T extends z.ZodType>(schema: T) {
  return z.object(Object.fromEntries(TIERS.map((tier) => [tier, schema])) as Record<Tier, T>);
}

/** Common..Legendary: the tiers that can go one step up (D-170, D-171). */
function perUpgradeTier<T extends z.ZodType>(schema: T) {
  return z.object(
    Object.fromEntries(UPGRADE_TIERS.map((tier) => [tier, schema])) as Record<UpgradeTier, T>,
  );
}

const moneyRange = z
  .object({ min: money, max: money })
  .refine((range) => range.min <= range.max, { message: 'min must be <= max' });

export const TierConfigSchema = z.object({
  designMultBp: positiveInt,
  lifespanHours: positiveInt,
  rarityPoints: z.number().int().nonnegative(),
  /** D-147: luck points a card of this tier gives when it pays for a spin. */
  cardLuckPoints: z.number().int().nonnegative(),
});

export const PackConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    enabled: z.boolean(),
    /** Free-by-timer pack: no price, eligible for the return bonus. */
    free: z.boolean(),
    /** Price per currency; a missing currency means the pack is not sold for it. */
    prices: z.partialRecord(z.enum(CURRENCIES), money),
    starsPrice: positiveInt.nullable(),
    baseLimit: z.record(z.enum(CURRENCIES), moneyRange),
    /** Minimum player level to open this pack. */
    unlockLevel: positiveInt,
    /** EXP granted per spin of this pack. */
    exp: z.number().int().nonnegative(),
    /** base_limit grows by this much per player level above 1 (free pack: small level scaling). */
    levelBaseLimitBonusBp: bp.default(0),
    tierWeights: perTier(z.number().int().nonnegative()),
    /** Guarantee a tier floor at least once per N spins of this pack; null disables it. */
    pity: z.object({
      rare: positiveInt.nullable(),
      epic: positiveInt.nullable(),
      legendary: positiveInt.nullable(),
    }),
  })
  .refine((pack) => Object.values(pack.tierWeights).some((weight) => weight > 0), {
    message: 'at least one tier weight must be positive',
    path: ['tierWeights'],
  })
  .refine(
    ({ pity }) => {
      const set = [pity.rare, pity.epic, pity.legendary].filter((n) => n !== null);
      return set.every((n, i) => i === 0 || n > (set[i - 1] ?? 0));
    },
    { message: 'pity thresholds must grow with the tier floor', path: ['pity'] },
  );

export const PatternConfigSchema = z.object({
  multBp: positiveInt,
  rarityPoints: z.number().int().nonnegative(),
  /** Weight of targeting this pattern when a new number is generated. */
  weight: z.number().int().nonnegative(),
});

const perCurrencyMoney = z.record(z.enum(CURRENCIES), money);

export const HolderConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  slots: positiveInt,
  unlockLevel: positiveInt,
  /** Price per currency; empty for the free starter holder. */
  prices: z.partialRecord(z.enum(CURRENCIES), money),
  starsPrice: positiveInt.nullable(),
});

/** D-147: free bonuses add luck points to the next spins (not a multiplier). */
const LuckBonusSchema = z.object({ points: positiveInt, spins: positiveInt });

const DailyRewardSchema = z.object({
  /** Credited to the wallet of the player's current region (scaled by player level). */
  money: z.partialRecord(z.enum(CURRENCIES), money).optional(),
  luck: LuckBonusSchema.optional(),
  freeSpins: positiveInt.optional(),
  /** The next spin is guaranteed at least this tier. */
  guaranteedFloor: z.enum(TIERS).optional(),
  /** Adds one chest to open. */
  chest: z.boolean().optional(),
});

const AchievementConditionSchema = z.discriminatedUnion('type', [
  /** Dropped a card of this tier or higher. */
  z.object({ type: z.literal('card_tier'), tier: z.enum(TIERS) }),
  /** Dropped a card with any of these number patterns. */
  z.object({ type: z.literal('pattern'), patterns: z.array(z.enum(PATTERN_IDS)).min(1) }),
  z.object({ type: z.literal('total_spins'), value: positiveInt }),
  z.object({ type: z.literal('level'), value: positiveInt }),
  z.object({ type: z.literal('trophies'), value: positiveInt }),
  z.object({ type: z.literal('quests'), value: positiveInt }),
  /** Wallets plus live cards, in RUB minor units. */
  z.object({ type: z.literal('net_worth'), value: money }),
  /** Granted at the end of a season (`seasons.medals`) and for a complete season collection. */
  z.object({ type: z.literal('season_rank') }),
  z.object({ type: z.literal('season_collection') }),
]);

const AchievementSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  icon: z.string().min(1).max(8),
  kind: z.enum(['permanent', 'season']),
  condition: AchievementConditionSchema,
  reward: z.object({
    money: z.partialRecord(z.enum(CURRENCIES), money).optional(),
    exp: positiveInt.optional(),
  }),
});

const QuestRewardSchema = z.object({
  /** Wallet of the player's region; daily quests scale it with the level (rewardLevelBonusBp). */
  money: z.partialRecord(z.enum(CURRENCIES), money).optional(),
  luck: LuckBonusSchema.optional(),
  freeSpins: positiveInt.optional(),
  exp: positiveInt.optional(),
});

const QuestDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  metric: z.enum(QUEST_METRICS),
  target: positiveInt,
  /** `cards_tier`: the lowest tier that counts. */
  tier: z.enum(TIERS).optional(),
  /** Daily quests: offered from this level on. */
  minLevel: positiveInt.optional(),
  reward: QuestRewardSchema,
});

const ChestRewardSchema = z.object({
  weight: positiveInt,
  /** Credited to the wallet of the player's current region (scaled by player level). */
  money: z.partialRecord(z.enum(CURRENCIES), money).optional(),
  luck: LuckBonusSchema.optional(),
  freeSpins: positiveInt.optional(),
  guaranteedFloor: z.enum(TIERS).optional(),
});

const ChestLevelSchema = z.object({
  level: positiveInt,
  /** Price to upgrade from the previous level; null for level 1. */
  upgradePrice: z.partialRecord(z.enum(CURRENCIES), money).nullable(),
  upgradeStarsPrice: positiveInt.nullable(),
  rewards: z.array(ChestRewardSchema).min(1),
});

const WheelSegmentSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  weight: positiveInt,
  money: z.partialRecord(z.enum(CURRENCIES), money).optional(),
  luck: LuckBonusSchema.optional(),
  freeSpins: positiveInt.optional(),
});

/** Fixed-price shop item (free spin bundles). */
export const ShopItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  prices: z.partialRecord(z.enum(CURRENCIES), money),
  freeSpins: positiveInt,
});

/**
 * Luck buff sold for a specific pack. Price = pack price × spins × pricePerSpinBp: the boost is worth
 * more on expensive packs, so it is priced from the pack it applies to.
 */
export const ShopBuffSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  boostBp: positiveInt,
  spins: positiveInt,
  pricePerSpinBp: positiveInt,
});

const NewbieStepSchema = z.union([z.object({ tier: z.enum(TIERS) }), z.object({ boostBp: bp })]);

/** D-169: field sizes of the mines game; the player picks the mine count within the range. */
export const MinesDifficultySchema = z
  .object({
    id: z.enum(MINIGAME_DIFFICULTIES),
    cells: z.number().int().min(4).max(64),
    minMines: positiveInt,
    maxMines: positiveInt,
  })
  .refine((d) => d.minMines <= d.maxMines && d.maxMines <= d.cells - 2, {
    message: 'mines must be within 1..cells-2 (one safe cell and the bonus cell)',
  });

/** D-169: a plinko board: `rows` rows of pegs and rows + 1 symmetric cups. */
export const PlinkoDifficultySchema = z
  .object({
    id: z.enum(MINIGAME_DIFFICULTIES),
    rows: z.number().int().min(4).max(20),
    multipliersBp: z.array(bp),
  })
  .refine(
    (d) =>
      d.multipliersBp.length === d.rows + 1 &&
      d.multipliersBp.every((m, i) => m === d.multipliersBp[d.rows - i]),
    { message: 'plinko needs rows + 1 symmetric multipliers' },
  );

/**
 * D-169: mini-games for wallet money. Pure chance: luck, pity and newcomer boosts do not apply.
 * A bet is at most maxBetShareBp of the wallet balance of its currency.
 */
export const MiniGamesConfigSchema = z.object({
  maxBetShareBp: bp.min(1).max(10_000),
  minBet: perCurrencyMoney,
  mines: z.object({
    /** Share of every fair mines multiplier kept by the game. */
    houseEdgeBp: bp.max(5000),
    /** The «SpinCards» cell adds this share to the winnings at the moment it is opened. */
    bonusBp: bp.max(50_000),
    difficulties: z.array(MinesDifficultySchema).length(MINIGAME_DIFFICULTIES.length),
  }),
  plinko: z.object({
    maxBalls: positiveInt.max(30),
    difficulties: z.array(PlinkoDifficultySchema).length(MINIGAME_DIFFICULTIES.length),
  }),
  /** Total return of a won flip (stake included). */
  coinflip: z.object({ payoutBp: bp.min(10_000).max(20_000) }),
  blackjack: z.object({
    decks: z.number().int().min(1).max(8),
    /** Total return of a natural 21 (stake included): 25 000 = 3:2. */
    blackjackPayoutBp: bp.min(20_000).max(30_000),
  }),
});

/**
 * D-170: four held cards of one tier become one new card. Their balances go to the wallet first
 * (the usual cash-out fee), the craft fee is paid from it, and with successBp the new card is one
 * tier up, otherwise the same tier. The new card's base limit is drawn from baseLimit.
 */
export const CraftConfigSchema = z.object({
  cards: z.number().int().min(2).max(10),
  successBp: perUpgradeTier(bp.max(10_000)),
  fee: perUpgradeTier(perCurrencyMoney),
  baseLimit: z.record(z.enum(CURRENCIES), moneyRange),
});

/** D-172: every album trophy pays money by its tier once per intervalHours (it does not pile up). */
export const AlbumIncomeConfigSchema = z.object({
  intervalHours: positiveInt,
  perTier: perTier(perCurrencyMoney),
});

/**
 * D-173: a reward once per claimHours while the player's Telegram name holds the tag; the name is
 * checked at sign-in and by the worker every checkHours.
 */
export const NickBonusConfigSchema = z.object({
  tag: z.string().min(1).max(64),
  checkHours: positiveInt,
  claimHours: positiveInt,
  /** D-178: money is paid as is (no level scaling); the floor applies to the next spin. */
  reward: QuestRewardSchema.extend({ guaranteedFloor: z.enum(TIERS).optional() }),
});

export const GameConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Wallet balances granted on sign-up (ledger reason signup_bonus). */
    startingBalance: z.partialRecord(z.enum(CURRENCIES), money),
    /** Currency conversion limits; the rate and fee live in `exchange_rates`. */
    conversion: z.object({
      minAmount: perCurrencyMoney,
      minFee: perCurrencyMoney,
      /** Max converted out of a currency per user per UTC day. */
      dailyLimit: perCurrencyMoney,
    }),
    /** Level n requires levels[n-1].exp total EXP; the first level must require 0. */
    levels: z
      .array(z.object({ level: positiveInt, exp: z.number().int().nonnegative() }))
      .min(1)
      .refine(
        (levels) =>
          levels.every(
            (l, i) =>
              l.level === i + 1 && (i === 0 ? l.exp === 0 : l.exp > (levels[i - 1]?.exp ?? 0)),
          ),
        { message: 'levels must be 1..N with exp starting at 0 and strictly growing' },
      ),
    holders: z.array(HolderConfigSchema).min(1),
    /** Free spins of `free` packs: one per interval, stored up to maxStored (TZ 5.7). */
    freeSpins: z.object({ intervalHours: positiveInt, maxStored: positiveInt }),
    /** Card lifetime after expiry (TZ 6). */
    /** D-121: a holder card pays for at most `spins` spins per window opened by its first spin. */
    cardSpinLimit: z.object({ spins: positiveInt, windowHours: positiveInt }),
    /**
     * D-129: the album (showcase) of trophies. freeSlots for everyone, more later for Stars; putting
     * a card in costs a price by rarity (same schedule shape as extensions).
     */
    /**
     * D-146: what Telegram Stars buy. Buffs stack without a purchase limit but stay under the common
     * luck cap; card items need the card's tier for the price.
     */
    stars: z
      .object({
        buffs: z
          .array(
            // D-147: a luck multiplier for some minutes; the strongest active one applies.
            z.object({
              id: z.string().regex(/^[a-z0-9_]{1,32}$/),
              multiplierBp: positiveInt,
              minutes: positiveInt,
              stars: positiveInt,
            }),
          )
          .max(10),
        freeSpins: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9_]{1,32}$/),
              count: positiveInt,
              stars: positiveInt,
            }),
          )
          .max(10),
        /** Resets a holder card's spin limit window. */
        cardLimitReset: positiveInt,
        /** Extends a card's life once more (over the usual one-time limit). */
        cardExtend: perTier(positiveInt),
        /** Saves a card to the album instead of paying its money price. */
        trophy: perTier(positiveInt),
        /** Makes the wheel of fortune ready at once. */
        wheelNow: positiveInt,
        /** D-171: raises a card one tier (Common..Legendary), priced by its current tier. */
        cardUpgrade: perUpgradeTier(positiveInt),
      })
      .default({
        buffs: [],
        freeSpins: [],
        cardLimitReset: 15,
        cardExtend: { common: 5, rare: 10, epic: 20, legendary: 35, mythic: 60 },
        trophy: { common: 10, rare: 25, epic: 50, legendary: 100, mythic: 200 },
        wheelNow: 10,
        cardUpgrade: { common: 25, rare: 50, epic: 100, legendary: 250 },
      }),
    showcase: z.object({
      freeSlots: positiveInt,
      price: z.object({
        base: perCurrencyMoney,
        tierGrowthBp: positiveInt,
        rarityPointBp: bp,
        rarityCapBp: positiveInt,
      }),
      /** Stars per extra slot (sold only when stars_enabled is on). */
      extraSlotStars: positiveInt,
    }),
    lifecycle: z.object({
      graceHours: positiveInt,
      /**
       * Extension price (D-115), paid from the wallet: base × tierGrowth^tier rank (common 0 …
       * mythic 4) × (1 + rarity points × rarityPointBp, at most rarityCapBp).
       */
      extendPrice: z.object({
        base: perCurrencyMoney,
        tierGrowthBp: positiveInt,
        rarityPointBp: bp,
        rarityCapBp: positiveInt,
      }),
      /** Extension length as a share of the original lifespan. */
      extendLifespanBp: positiveInt,
      maxExtends: z.number().int().nonnegative(),
      /** Restoring an expired card costs the extension price times this. */
      restoreMultBp: positiveInt,
      expiredCashoutFeeBp: bp.max(10_000),
    }),
    exp: z.object({
      /** Extra EXP for dropping a card of this tier. */
      tierBonus: perTier(z.number().int().nonnegative()),
      dailyClaim: z.number().int().nonnegative(),
    }),
    /** Daily login streak (TZ 8): rewards for days 1..N, one forgiven missed day per window. */
    /**
     * D-125/D-132: two-week seasons. Score = rarity of dropped cards + net worth in RUB / rubPerPoint
     * + level × levelPoints. At the end the top get medals; money, cards and level start over, and
     * the next season's start money grows with the score (carryover, capped).
     */
    seasons: z.object({
      lengthDays: positiveInt,
      score: z.object({ rubPerPoint: positiveInt, levelPoints: bp }),
      carryover: z.object({ perPoint: perCurrencyMoney, cap: perCurrencyMoney }),
      medals: z.array(z.object({ maxRank: positiveInt, achievementId: z.string() })),
    }),
    /** D-133: achievements (medals) with rewards; season ones can be earned again each season. */
    achievements: z.array(AchievementSchema),
    /** D-124: a few random daily quests (new each Moscow day) and a fixed list per season. */
    quests: z.object({
      dailyCount: positiveInt,
      daily: z.array(QuestDefSchema).min(1),
      season: z.array(QuestDefSchema),
      /**
       * D-157: a separate season quest "join the channel" on top of the list; the channels are the
       * subscription channels from the admin panel. Absent: no such quest.
       */
      channel: z.object({ reward: QuestRewardSchema }).optional(),
      /**
       * D-158: "invite friends" next to the channel quest: a reward for every step of friends who
       * qualified for the referral reward this season, each once a season. Absent: no such quest.
       */
      invite: z
        .object({
          steps: z
            .array(z.object({ friends: positiveInt, reward: QuestRewardSchema }))
            .min(1)
            .refine(
              (steps) => steps.every((s, i) => i === 0 || s.friends > (steps[i - 1]?.friends ?? 0)),
              {
                message: 'steps must grow',
              },
            ),
        })
        .optional(),
    }),
    daily: z.object({
      rewards: z.array(DailyRewardSchema).min(1),
      forgivenessWindowDays: positiveInt,
      /** Daily money grows by this much per player level above 1 (instead of rewardLevelBonusBp). */
      levelBonusBp: bp,
      /** Every N levels a daily free-spin reward gives one more spin and a buff one more spin. */
      levelStep: positiveInt,
    }),
    /** Money rewards (daily, chest, wheel) grow by this much per player level above 1. */
    rewardLevelBonusBp: bp,
    /** A chest every N spins (TZ 8), up to maxStored unclaimed; upgradable levels improve rewards. */
    chest: z.object({
      everySpins: positiveInt,
      maxStored: positiveInt,
      levels: z
        .array(ChestLevelSchema)
        .min(1)
        .refine((levels) => levels.every((l, i) => l.level === i + 1), {
          message: 'chest levels must be 1..N',
        }),
    }),
    /** Free wheel of fortune every intervalHours; result decided by the server, odds published. */
    wheel: z.object({
      intervalHours: positiveInt,
      segments: z.array(WheelSegmentSchema).min(2),
    }),
    /** Shop for currency (TZ 8). Holders and card actions have own routes. */
    shop: z.object({
      items: z.array(ShopItemSchema),
      buffs: z.array(ShopBuffSchema),
      /** Luck buffs a player may buy per UTC day. */
      buffDailyLimit: positiveInt,
    }),
    /**
     * Transfers between a player's cards and wallet: wallet->card is free, card->card costs
     * cardToCardFeeBp, card->wallet costs the level-based cash-out fee (it is a partial cash-out).
     */
    transfer: z.object({ cardToCardFeeBp: bp.max(10_000) }),
    /** D-131: money sent to another player by @username (from the wallet, same currency). */
    p2p: z.object({
      minLevel: positiveInt,
      feeBp: bp.max(10_000),
      minAmount: perCurrencyMoney,
      /** Per player per UTC day, for sending and for receiving separately. */
      dailyLimit: perCurrencyMoney,
    }),
    /**
     * Bot notifications (TZ 14). Quiet hours are local to the player's region (timezone per region);
     * a message due inside them waits until `quietEndHour`. `dailyLimit` caps game notifications per
     * player per local day (broadcasts are not counted).
     */
    notifications: z.object({
      quietStartHour: z.number().int().min(0).max(23),
      quietEndHour: z.number().int().min(0).max(23),
      timezones: z.record(z.enum(REGIONS), z.string().min(1)),
      dailyLimit: positiveInt,
      cardExpiringHours: positiveInt,
      comebackAfterHours: positiveInt,
      maxAttempts: positiveInt,
      /** Telegram allows about 30 messages per second; broadcasts stay below it. */
      perSecond: positiveInt.max(30),
    }),
    /** Daily metrics (TZ 15.1): days are counted in this timezone; app opens closer than the gap
     * belong to one session. */
    analytics: z.object({
      timezone: z.string().min(1),
      sessionGapMinutes: positiveInt,
      /** D-152: statistics start here (ISO time); earlier data (the alpha) is left out. */
      since: z.iso.datetime().nullable().default(null),
    }),
    /** Collection level thresholds by total rarity of held cards; must start at 0 and grow. */
    collectionLevels: z
      .array(z.number().int().nonnegative())
      .min(1)
      .refine((l) => l[0] === 0 && l.every((v, i) => i === 0 || v > (l[i - 1] ?? 0)), {
        message: 'collection levels must start at 0 and grow',
      }),
    /** Both players are rewarded once the invited one reaches the thresholds (TZ 8). */
    referral: z.object({
      spinsRequired: positiveInt,
      levelRequired: positiveInt,
      referrerReward: perCurrencyMoney,
      referredReward: perCurrencyMoney,
      /**
       * Max rewarded referrals per referrer per UTC day; the rest wait for the next day. 0: no
       * limit (D-158).
       */
      dailyLimit: z.number().int().nonnegative(),
      /**
       * Once the friend qualifies, the referrer earns `shareBp` of the friend's paid spins made
       * within `days` of joining (in the spin's currency, paid by the worker).
       */
      commission: z.object({
        shareBp: bp.max(10_000),
        days: positiveInt,
        /** D-119: at most this much per referred player over the whole window... */
        capPerReferral: perCurrencyMoney,
        /** ...and per referrer per UTC day, so twinks cannot be farmed for commission. */
        dailyCapPerReferrer: perCurrencyMoney,
      }),
    }),
    tiers: perTier(TierConfigSchema),
    regions: z.record(
      z.enum(REGIONS),
      z.object({
        currency: z.enum(CURRENCIES),
        banks: z.array(z.object({ id: z.string().min(1), weight: positiveInt })).min(1),
      }),
    ),
    packs: z.array(PackConfigSchema).min(1),
    patterns: z.object({
      byId: z.object(
        Object.fromEntries(PATTERN_IDS.map((id) => [id, PatternConfigSchema])) as Record<
          (typeof PATTERN_IDS)[number],
          typeof PatternConfigSchema
        >,
      ),
      noPatternWeight: z.number().int().nonnegative(),
      numberMultCapBp: positiveInt,
    }),
    luck: z.object({
      meterMax: positiveInt,
      luckyEpicPlusMultBp: positiveInt,
      /** Cap on the combined boost of Rare+ weights (card, buffs, lucky, newbie) over the base. */
      boostCapBp: bp,
      /**
       * D-147: the player's luck, 0..maxPoints, is all they see; each point is pointBp of hidden
       * boost on Rare+ chances and on beautiful numbers.
       */
      maxPoints: positiveInt,
      pointBp: positiveInt,
      badStreakLength: positiveInt,
      badStreakMeterBonus: positiveInt,
      returnAfterHours: positiveInt,
      newbieScript: z.array(NewbieStepSchema),
      /** A lucky spin also guarantees at least this tier (null: no floor). */
      luckyFloor: z.enum(TIERS).nullable(),
      /** Every `everySpins`-th spin of a player is a showcase lucky spin of at least `floor`. */
      milestone: z.object({ everySpins: positiveInt, floor: z.enum(TIERS) }),
      /**
       * D-116: hidden extra luck on Rare+ weights, applied on top of boostCapBp and never shown to
       * players. The larger of the two applies.
       */
      hidden: z.object({
        /** Everyone whose wallet plus active cards are below this (spin currency) gets lowBalanceBoostBp. */
        lowBalanceBelow: perCurrencyMoney,
        lowBalanceBoostBp: bp,
        /** The first newbieSpins spins of a player get newbieBoostBp. */
        newbieSpins: z.number().int().nonnegative(),
        newbieBoostBp: bp,
      }),
    }),
    /** D-119: thresholds of the "suspicious" list in the admin panel (signals only, no auto-ban). */
    antifraud: z.object({
      /** Spins of one player within the last hour. */
      spinsPerHour: positiveInt,
      /** Referrals of one player within the last 24 hours. */
      referralsPerDay: positiveInt,
      /** Players seen from the same IP within 7 days. */
      sharedIpUsers: positiveInt,
      /** D-131: distinct players a player received transfers from within 24 hours. */
      p2pSendersPerDay: positiveInt,
    }),
    /** D-128: a card's luck = its tier's bonus + pattern points × this, up to the cap. */
    /** D-147: luck points of a card's number: per pattern rarity point, up to the cap. */
    cardLuck: z.object({
      pointsPerPatternPoint: z.number().int().nonnegative(),
      numberCapPoints: z.number().int().nonnegative(),
    }),
    pool: z.object({ redropChanceBp: bp.max(10_000) }),
    numberGeneration: z.object({ maxAttempts: positiveInt }),
    nearMiss: z.object({ patternIds: z.array(z.enum(PATTERN_IDS)) }),
    cashout: z.object({
      baseFeeBp: bp.max(10_000),
      feeReductionPerLevelBp: bp,
      minFeeBp: bp.max(10_000),
    }),
    simulation: z.object({
      rtpCorridor: z
        .object({ minBp: bp, maxBp: bp })
        .refine((c) => c.minBp <= c.maxBp, { message: 'minBp must be <= maxBp' }),
      /** D-141: player level of the best-card check (a lower cash-out fee pays out more). */
      bestCardLevel: z.number().int().min(1).default(100),
    }),
    /**
     * Safeguards (TZ 15.2): an alert when today's emission of a currency passes the limit, and an
     * alert plus (optionally) an automatic pause of a pack whose factual RTP over the window leaves
     * [minBp, maxBp] with at least `minSpins` paid spins.
     */
    /** D-169: absent in older versions: the mini-games stay closed until a version adds them. */
    minigames: MiniGamesConfigSchema.optional(),
    /** D-170..D-173: absent in older versions (filled from the defaults); flags open them. */
    craft: CraftConfigSchema.optional(),
    albumIncome: AlbumIncomeConfigSchema.optional(),
    nickBonus: NickBonusConfigSchema.optional(),
    /** D-177: links the Mini App opens (the news channel). */
    links: z.object({ newsUrl: z.url() }).optional(),
    safeguards: z.object({
      dailyEmission: perCurrencyMoney,
      rtp: z.object({
        windowMinutes: positiveInt,
        minSpins: positiveInt,
        minBp: bp,
        maxBp: bp,
        autoPause: z.boolean(),
      }),
    }),
  })
  .refine((config) => new Set(config.packs.map((pack) => pack.id)).size === config.packs.length, {
    message: 'pack ids must be unique',
    path: ['packs'],
  });

export type GameConfig = z.infer<typeof GameConfigSchema>;
export type PackConfig = z.infer<typeof PackConfigSchema>;
export type TierConfig = z.infer<typeof TierConfigSchema>;
export type PatternConfig = z.infer<typeof PatternConfigSchema>;
export type NewbieStep = z.infer<typeof NewbieStepSchema>;
export type QuestDef = z.infer<typeof QuestDefSchema>;
export type AchievementDef = z.infer<typeof AchievementSchema>;
export type AchievementCondition = z.infer<typeof AchievementConditionSchema>;
export type QuestReward = z.infer<typeof QuestRewardSchema>;
export type HolderConfig = z.infer<typeof HolderConfigSchema>;
export type DailyReward = z.infer<typeof DailyRewardSchema>;
export type ChestReward = z.infer<typeof ChestRewardSchema>;
export type ChestLevel = z.infer<typeof ChestLevelSchema>;
export type WheelSegment = z.infer<typeof WheelSegmentSchema>;
export type ShopItem = z.infer<typeof ShopItemSchema>;
export type ShopBuff = z.infer<typeof ShopBuffSchema>;
export type MiniGamesConfig = z.infer<typeof MiniGamesConfigSchema>;
export type CraftConfig = z.infer<typeof CraftConfigSchema>;
export type AlbumIncomeConfig = z.infer<typeof AlbumIncomeConfigSchema>;
export type NickBonusConfig = z.infer<typeof NickBonusConfigSchema>;
