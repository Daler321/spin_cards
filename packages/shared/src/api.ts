import type { GameConfig } from './game/config-schema.js';
import type {
  AchievementCondition,
  AlbumIncomeConfig,
  ChestReward,
  DailyReward,
  NickBonusConfig,
  PackConfig,
  ShopBuff,
  ShopItem,
  WheelSegment,
} from './game/config-schema.js';
import type {
  CardDesign,
  Currency,
  MiniGameDifficulty,
  PatternId,
  QuestKind,
  QuestMetric,
  Region,
  Tier,
  UpgradeTier,
} from './game/constants.js';

/**
 * Response shapes of the REST API (/v1). Money is an integer number of minor units, timestamps are
 * ISO strings. The api builds them, web and admin read them.
 */

export interface IssuedTokens {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
}

export interface WalletBalance {
  currency: string;
  balance: number;
}

/** Telegram Stars (behind `stars_enabled`, TZ 9): the Mini App opens the link with openInvoice. */
/** Required channel subscription (D-110): channels the player must join to play. */
export interface SubscriptionChannel {
  /** @username or numeric chat id (-100…). */
  chatId: string;
  title: string;
  /** Link the player opens to join. */
  url: string;
}

export interface SubscriptionStatus {
  required: boolean;
  ok: boolean;
  channels: (Omit<SubscriptionChannel, 'chatId'> & { joined: boolean })[];
}

/** Card sharing (D-114): the Mini App uploads a rendered JPEG, then saves or shares it. */
export interface ShareImageRequest {
  cardId: string;
  /** Base64 JPEG without the data: prefix. */
  image: string;
}

export interface ShareImageResponse {
  token: string;
  /** Public HTTPS URL (an hour) for downloadFile and Telegram. */
  url: string;
}

export interface SharePrepareRequest {
  token: string;
  caption: string;
}

export interface SharePrepareResponse {
  /** For WebApp.shareMessage. */
  preparedMessageId: string;
}

/** Events the Mini App reports (POST /v1/events); the rest is tracked by the server. */
export const CLIENT_EVENTS = ['app_open'] as const;
export type ClientEventName = (typeof CLIENT_EVENTS)[number];

export interface StarsInvoiceRequest {
  productId: string;
  idempotencyKey: string;
}

export interface StarsInvoiceResponse {
  paymentId: string;
  invoiceLink: string;
}

export interface MeResponse {
  /** The season going on now (D-143): its name and end. */
  season: { name: string; endsAt: string | null };
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  photoUrl: string | null;
  region: Region;
  level: number;
  exp: number;
  /** Total EXP needed for the next level, null at the max level. */
  nextLevelExp: number | null;
  referralCode: string;
  wallets: WalletBalance[];
  settings: {
    notificationsEnabled: boolean;
    hideFromLeaderboard: boolean;
    /** D-175: dropped cards of these tiers are cashed out to the wallet at once. */
    autoCashoutTiers: Tier[];
  };
  createdAt: string;
  game: {
    freeSpins: { available: number; nextAt: string | null };
    luckMeters: { packId: string; value: number; max: number }[];
    buffs: BuffView[];
    guaranteedFloor: Tier | null;
    /** Dropped card awaiting a decision; spins are blocked until it is cashed out or kept. */
    pendingCardId: string | null;
    daily: { streak: number; claimedToday: boolean };
    totalSpins: number;
    /** Progress to the next milestone (showcase lucky) spin, every `max` spins. */
    milestone: { value: number; max: number };
    /** The next free spin is lucky (comeback bonus). */
    returnLuckyPending: boolean;
    /** Completed quests waiting to be claimed (D-124). */
    questsReady: number;
    chest: ChestView;
    /** Free wheel spin: null means available now. */
    wheel: { availableAt: string | null };
    /** Level-based cash-out fee; also the fee of a card→wallet transfer. */
    cashoutFeeBp: number;
    /** D-172: album income; null while closed. availableAt null: ready (if the album has trophies). */
    albumIncome: { availableAt: string | null; trophies: number } | null;
    /** D-173: the name tag bonus; null while closed. */
    nickBonus: NickBonusView | null;
  };
}

/** D-173: whether the last check saw the tag, and when the bonus can be claimed (null: now). */
export interface NickBonusView {
  tag: string;
  hasTag: boolean;
  checkedAt: string | null;
  availableAt: string | null;
}

export interface NickBonusClaimResponse {
  credited: { currency: string; amount: number } | null;
  freeSpins: number;
  availableAt: string;
}

/** D-172: money of every trophy by tier, once per interval. */
export interface AlbumIncomeClaimResponse {
  amount: number;
  currency: string;
  wallet: WalletBalance;
  availableAt: string;
}

/** D-170: N cards of one tier become one; consumed cards leave the game. */
export interface CraftRequest {
  cardIds: string[];
  idempotencyKey: string;
}

export interface CraftResponse {
  success: boolean;
  card: CardView;
  consumedCardIds: string[];
  /** The consumed cards' balances paid to the wallet (after the cash-out fee), and the craft fee. */
  payout: number;
  fee: number;
  wallet: WalletBalance;
}

/** D-174: every other held card of the currency sends its whole balance to one place. */
export interface CollectRequest {
  currency: Currency;
  to: TransferEndpoint;
  idempotencyKey: string;
}

export interface CollectResponse {
  cards: number;
  amount: number;
  fee: number;
  received: number;
  wallet: WalletBalance;
}

/** D-147: a running luck bonus: +points for some spins, or a Stars multiplier until it expires. */
export interface BuffView {
  points: number | null;
  multiplierBp: number | null;
  spinsLeft: number | null;
  expiresAt: string | null;
  /** Old shop buffs worked on one pack; null = any pack. */
  packId: string | null;
}

export interface ChestView {
  available: number;
  progress: number;
  everySpins: number;
  level: number;
}

export interface PatternMatchView {
  id: PatternId;
  start: number;
  length: number;
}

export type CardStatusView = 'active' | 'expired' | 'pooled' | 'cashed' | 'trophy' | 'crafted';

export interface CardView {
  id: string;
  number: string;
  bankId: string;
  region: Region;
  currency: string;
  tier: Tier;
  patterns: PatternMatchView[];
  rarityScore: number;
  balance: number;
  initialBalance: number;
  /** D-147: luck points (0..100) this card gives when it pays for a spin. */
  luckPoints: number;
  ownersCount: number;
  status: CardStatusView;
  held: boolean;
  issuedAt: string;
  expiresAt: string;
  graceUntil: string | null;
  extendedCount: number;
  /** What cashing out now would pay (penalty fee applies to expired cards). */
  cashoutValue: number;
  /** D-121: spins this card can still pay for in its current window, and when the window resets. */
  spinLimit: { left: number; max: number; resetsAt: string | null };
  /** D-129: what putting the card into the album costs (in its currency). */
  trophyPrice: number;
  /** D-168: the design a trophy was kept with; null = the current season's (`cardDesign`). */
  design: CardDesign | null;
}

export interface NearMissView {
  patternId: PatternId;
  /** Index (0..15) of the digit that differs. */
  position: number;
  digit: number;
}

export type SpinPaymentRequest = { type: 'wallet' } | { type: 'card'; cardId: string };

export const MAX_SPINS_PER_REQUEST = 4;

export interface SpinRequest {
  packId: string;
  payment: SpinPaymentRequest;
  /** 1..MAX_SPINS_PER_REQUEST spins paid and resolved together, one after another. */
  count?: number;
  idempotencyKey: string;
}

export interface SpinItem {
  spinId: string;
  card: CardView;
  lucky: 'meter' | 'return' | 'milestone' | null;
  pityApplied: Tier | null;
  guaranteeApplied: boolean;
  /** Honest "almost" hint; null when there is none or the near_miss_ux flag is off. */
  nearMiss: NearMissView | null;
  /**
   * D-175/D-178: the card was sold by the auto-sell setting (payout after the fee): onto the card
   * that paid for the spin (`toCardId`), or to the wallet (null).
   */
  autoCashedOut: { payout: number; toCardId: string | null } | null;
}

export interface SpinResponse {
  spins: SpinItem[];
  /** D-133: achievements earned by this batch (ids). */
  achievements: string[];
  exp: { gained: number; total: number; level: number; leveledUp: boolean };
  wallets: WalletBalance[];
  /** Remaining balance of the card that paid for the spin. */
  paymentCard: { id: string; balance: number } | null;
  freeSpins: { available: number; nextAt: string | null };
  luckMeter: { value: number; max: number };
}

export interface HolderView {
  cards: CardView[];
  /** Just-dropped cards awaiting "cash out" or "keep" (several after a multi-spin). */
  pending: CardView[];
  slots: { used: number; total: number };
  /** Holder ids the player owns (slots stack). */
  ownedHolders: string[];
  /** Total rarity of held cards and the collection level it reaches. */
  collection: { score: number; level: number; nextLevelScore: number | null };
}

export interface CashoutResponse {
  cardId: string;
  payout: number;
  fee: number;
  /** Where the payout went: the wallet of the card currency, or another held card. */
  wallet: WalletBalance | null;
  toCard: { id: string; balance: number } | null;
}

export interface CardActionResponse {
  card: CardView;
  wallets?: WalletBalance[];
}

export interface ConvertResponse {
  conversionId: string;
  from: Currency;
  to: Currency;
  amountFrom: number;
  fee: number;
  amountTo: number;
  wallets: WalletBalance[];
}

/** Groups of the wallet history filter; each maps to ledger reasons (D-122). */
export const HISTORY_GROUPS = {
  spins: ['spin_cost'],
  cashout: ['cashout'],
  cards: ['topup', 'transfer', 'extend', 'restore'],
  exchange: ['convert_in', 'convert_out'],
  bonuses: ['signup_bonus', 'daily', 'chest', 'wheel', 'referral', 'quest', 'season_reward'],
  purchases: ['shop', 'stars_purchase', 'stars_refund', 'trophy'],
  players: ['p2p'],
  other: ['admin_adjust', 'card_issue', 'card_burn'],
} as const satisfies Record<string, readonly string[]>;
export type HistoryGroup = keyof typeof HISTORY_GROUPS;
export const HISTORY_PERIODS = [1, 7, 30] as const;

export interface HistoryFilter {
  group?: HistoryGroup;
  currency?: string;
  /** Only the last N days. */
  days?: (typeof HISTORY_PERIODS)[number];
}

export interface HistoryItem {
  id: string;
  currency: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

export interface DailyClaimResponse {
  day: number;
  forgiven: boolean;
  reward: DailyReward;
  /** Money actually credited (currency of the player's region), if the reward had any. */
  credited: { currency: string; amount: number } | null;
  exp: { gained: number; total: number; level: number };
}

export interface BuyHolderResponse {
  holderId: string;
  slotsTotal: number;
  wallet: WalletBalance;
}

export interface PublicPack {
  id: string;
  free: boolean;
  prices: PackConfig['prices'];
  starsPrice: number | null;
  /** Published base odds in basis points. */
  oddsBp: Record<Tier, number>;
  pity: PackConfig['pity'];
  baseLimit: PackConfig['baseLimit'];
  unlockLevel: number;
  patternCapBp: number;
}

/** D-146: Telegram Stars offers (prices in Stars). */
export interface StarsCatalog {
  buffs: { id: string; multiplierBp: number; minutes: number; stars: number }[];
  freeSpins: { id: string; count: number; stars: number }[];
  cardLimitReset: number;
  cardExtend: Record<Tier, number>;
  trophy: Record<Tier, number>;
  wheelNow: number;
  albumSlot: number;
  /** D-171: one tier up for a card of this tier; null while the flag craft_enabled is off. */
  cardUpgrade: Record<UpgradeTier, number> | null;
}

export interface PublicConfigResponse {
  /** Null while Stars payments are off. */
  stars: StarsCatalog | null;
  configVersion: number;
  packs: PublicPack[];
  tiers: { tier: Tier; lifespanHours: number; cardLuckPoints: number }[];
  holders: {
    id: string;
    slots: number;
    unlockLevel: number;
    prices: Partial<Record<Currency, number>>;
    starsPrice: number | null;
  }[];
  levels: { level: number; exp: number }[];
  conversion: {
    minAmount: Record<Currency, number>;
    minFee: Record<Currency, number>;
    dailyLimit: Record<Currency, number>;
    rates: { fromCurrency: string; toCurrency: string; rateNano: string; feeBp: number }[];
  };
  /** D-147: the luck scale (0..maxPoints) and the cap of a card's number part. */
  luck: { meterMax: number; maxPoints: number; numberCapPoints: number };
  transfer: { cardToCardFeeBp: number };
  freeSpins: { intervalHours: number; maxStored: number };
  /** Working bank names live in the database (TZ 4.3), the client only renders them. */
  banks: { id: string; region: Region; color: string; name: string }[];
  /** Pattern multipliers and rarity points for the "Odds" screen (generation weights stay private). */
  patterns: { id: PatternId; multBp: number; rarityPoints: number }[];
  numberMultCapBp: number;
  /** D-168: the card design of the current season. */
  cardDesign: CardDesign;
  lifecycle: Pick<
    GameConfig['lifecycle'],
    'graceHours' | 'extendPrice' | 'extendLifespanBp' | 'restoreMultBp'
  >;
  daily: { rewards: DailyReward[]; levelBonusBp: number; levelStep: number };
  /** Money rewards grow by this much per player level above 1. */
  rewardLevelBonusBp: number;
  chest: {
    everySpins: number;
    maxStored: number;
    levels: {
      level: number;
      upgradePrice: Partial<Record<Currency, number>> | null;
      upgradeStarsPrice: number | null;
      /** Published odds of each reward in basis points. */
      rewards: (Omit<ChestReward, 'weight'> & { oddsBp: number })[];
    }[];
  };
  wheel: { intervalHours: number; segments: (Omit<WheelSegment, 'weight'> & { oddsBp: number })[] };
  /** D-170: craft rules (published odds); null while closed. */
  craft: {
    cards: number;
    successBp: Record<UpgradeTier, number>;
    fee: Record<UpgradeTier, Record<Currency, number>>;
  } | null;
  /** D-172, D-173: null while closed. */
  albumIncome: AlbumIncomeConfig | null;
  nickBonus: NickBonusConfig | null;
  /** D-177: the news channel; null when the config has none. */
  newsUrl: string | null;
  shop: { items: ShopItem[]; buffs: ShopBuff[]; buffDailyLimit: number };
  collectionLevels: number[];
  referral: {
    spinsRequired: number;
    levelRequired: number;
    referrerReward: Record<Currency, number>;
    referredReward: Record<Currency, number>;
    commission: { shareBp: number; days: number };
  };
  /** Bot username for t.me referral links (from getMe at runtime); empty when unknown. */
  botUsername: string;
  /** D-134: owner-edited Mini App texts (`ns:key` → text) over the i18n defaults. */
  texts: Record<string, string>;
  /** D-131: transfers between players. */
  p2p: {
    minLevel: number;
    feeBp: number;
    minAmount: Record<Currency, number>;
    dailyLimit: Record<Currency, number>;
  };
}

export interface ChestClaimResponse {
  reward: Omit<ChestReward, 'weight'>;
  credited: { currency: string; amount: number } | null;
  chest: ChestView;
}

export interface ChestUpgradeResponse {
  chest: ChestView;
  wallet: WalletBalance;
}

export interface WheelSpinResponse {
  segmentIndex: number;
  segmentId: string;
  reward: Omit<WheelSegment, 'weight'>;
  credited: { currency: string; amount: number } | null;
  availableAt: string;
}

export interface ShopBuyRequest {
  itemId: string;
  /** Required for luck buffs: the pack the buff works on. */
  packId?: string;
  currency: Currency;
  idempotencyKey: string;
}

export interface ShopBuyResponse {
  itemId: string;
  wallet: WalletBalance;
  freeSpins: { available: number; nextAt: string | null };
  buffs: BuffView[];
}

export interface ReferralsResponse {
  code: string;
  spinsRequired: number;
  levelRequired: number;
  invited: {
    firstName: string;
    status: 'pending' | 'rewarded';
    spins: number;
    level: number;
    joinedAt: string;
    /** Commission earned from this friend, per currency (minor units). */
    earned: { currency: string; amount: number }[];
    /** Until when this friend's spins earn commission. */
    commissionUntil: string;
  }[];
}

/** Season: points of the current season (D-125); balance, collection and album: all time. */
export type LeaderboardType = 'season' | 'balance' | 'collection' | 'album';
export const LEADERBOARD_TYPES = ['season', 'balance', 'collection', 'album'] as const;

/** D-177: the current season and the earlier ones. */
export interface SeasonsResponse {
  current: {
    name: string;
    /** N of «Сезон N»; null for named (test) seasons. */
    number: number | null;
    startsAt: string;
    endsAt: string | null;
    /** Seasons before this one. */
    finished: number;
  };
  past: { name: string; startsAt: string; endsAt: string | null }[];
}

/** Public profile of a ranked player (tap in the rating). */
export interface PlayerProfileResponse {
  userId: string;
  /** D-137: icons of the medals the player shows. */
  medals: string[];
  firstName: string;
  photoUrl: string | null;
  level: number;
  totalSpins: number;
  /** Spins in the current season (D-160). */
  seasonSpins: number;
  memberSince: string;
  collection: { score: number; level: number; nextLevelScore: number | null; cards: number };
  /** The rarest live cards, up to six. */
  topCards: CardView[];
  /** The player's album of trophies (D-129). */
  trophies: CardView[];
}

export interface LeaderboardEntry {
  /** Opens the player's public profile (GET /v1/players/:id). */
  userId: string;
  rank: number;
  firstName: string;
  photoUrl: string | null;
  level: number;
  /** Balance: sum of wallets in RUB minor units; collection: sum of rarity scores. */
  score: number;
  isMe: boolean;
  /** D-137: icons of the medals the player shows (chosen, or the rarest earned), up to 3. */
  medals: string[];
}

export interface LeaderboardResponse {
  type: LeaderboardType;
  top: LeaderboardEntry[];
  /** The player's own place; null when hidden from the leaderboard. */
  me: LeaderboardEntry | null;
  /** The season rating only: when it ends and what the top gets (D-125). */
  season?: {
    name: string;
    endsAt: string | null;
    /** Medals of the final ranks (the narrowest bracket that covers a rank). */
    medals: { maxRank: number; icon: string; achievementId: string }[];
    /** Start money of the next season: + perPoint × score, up to cap. */
    carryover: { perPoint: Record<Currency, number>; cap: Record<Currency, number> };
  };
}

export interface SettingsRequest {
  notificationsEnabled?: boolean;
  hideFromLeaderboard?: boolean;
  /** D-175: tiers sold at once after a drop. */
  autoCashoutTiers?: Tier[];
  /** D-137: achievement ids to show in the rating (up to 3); empty: the rarest earned ones. */
  pinnedMedals?: string[];
}

/** D-137: how many medals a player shows next to the name in the rating. */
export const PINNED_MEDALS_MAX = 3;

export interface ProfileStats {
  totalSpins: number;
  season: {
    name: string;
    spins: number;
    cardsIssued: number;
    bestRarity: number;
    cashedOut: number;
    /** Season score (the season rating, D-132) and its parts. */
    score: { cards: number; money: number; level: number; total: number };
  };
  /** Results of finished seasons, newest first. */
  pastSeasons: { name: string; rank: number; points: number }[];
  holder: { cards: number; slots: number };
}

export type TransferEndpoint = { type: 'wallet' } | { type: 'card'; cardId: string };

export interface TransferRequest {
  from: TransferEndpoint;
  to: TransferEndpoint;
  /** Amount taken from the source, in minor units; the fee is deducted from it. */
  amount: number;
  idempotencyKey: string;
}

export interface TransferResponse {
  amount: number;
  fee: number;
  /** What the destination received. */
  received: number;
  wallet: WalletBalance;
  cards: { id: string; balance: number }[];
}

export interface BatchCashoutResponse {
  cardIds: string[];
  payout: number;
  fee: number;
  wallet: WalletBalance | null;
  toCard: { id: string; balance: number } | null;
}

/** A daily or season quest of the player (D-124). */
export interface QuestView {
  id: string;
  questId: string;
  kind: QuestKind;
  metric: QuestMetric;
  tier: Tier | null;
  target: number;
  progress: number;
  /** What claiming pays now: money already in the player's currency and level. */
  reward: {
    money: { currency: string; amount: number } | null;
    luck: { points: number; spins: number } | null;
    freeSpins: number | null;
    exp: number | null;
  };
  completed: boolean;
  claimed: boolean;
}

/** D-157: "join the channel" quest; shown until its reward is taken this season. */
export interface ChannelQuestView {
  channels: { title: string; url: string }[];
  reward: QuestView['reward'];
}

export interface ChannelQuestClaimResponse {
  credited: { currency: string; amount: number } | null;
  exp: { gained: number; total: number; level: number };
}

/** D-158: "invite friends": friends who qualified this season and the reward steps. */
export interface InviteQuestView {
  friends: number;
  steps: { friends: number; reward: QuestView['reward']; claimed: boolean }[];
  /** What a friend has to do to count (the referral reward condition). */
  rule: { spins: number; level: number };
}

export interface QuestsResponse {
  daily: QuestView[];
  season: QuestView[];
  /** Null when there is no such quest (no channels or reward) or its reward is already taken. */
  channel: ChannelQuestView | null;
  /** Null when there is no such quest or every step is taken this season. */
  invite: InviteQuestView | null;
  /** New daily quests at this moment (00:00 Moscow time). */
  dailyResetsAt: string;
  seasonEndsAt: string | null;
}

export interface QuestClaimResponse {
  quest: QuestView;
  credited: { currency: string; amount: number } | null;
  exp: { gained: number; total: number; level: number };
}

/** The permanent collection (D-126): what the player has ever got, kept after the card is gone. */
/** The album of trophies (D-129). */
export interface AlbumResponse {
  slots: { used: number; total: number; free: number };
  trophies: CardView[];
  /** Stars per extra slot; null while Stars payments are off. */
  extraSlotStars: number | null;
  /** D-172: what the next claim pays and when; null while closed. */
  income: { amount: number; currency: string; availableAt: string | null } | null;
}

/** The season collection (D-130): which bank × tier of the season's banks the player has dropped. */
export interface SeasonCollectionResponse {
  season: string;
  collected: number;
  total: number;
  banks: {
    id: string;
    name: string;
    region: Region;
    color: string;
    tiers: Record<Tier, { at: string; number: string } | null>;
  }[];
}

/** D-139: a trophy removed from the album; the card is gone for good. */
export interface TrophyRemoveResponse {
  cardId: string;
}

export interface TrophyResponse {
  card: CardView;
  /** Paid for the album slot. */
  price: number;
  /** The card's balance cashed out to the wallet before it became a trophy. */
  payout: number;
  wallet: WalletBalance;
}

/** D-131: a player found by @username, shown before sending money. */
export interface P2pRecipient {
  userId: string;
  username: string;
  firstName: string;
  photoUrl: string | null;
  level: number;
}

export interface P2pSendRequest {
  username: string;
  currency: Currency;
  /** Taken from the sender's wallet in minor units; the recipient gets it minus the fee. */
  amount: number;
  idempotencyKey: string;
}

export interface P2pSendResponse {
  transferId: string;
  amount: number;
  fee: number;
  received: number;
  wallet: WalletBalance;
}

/** D-133: the medals catalogue with what the player has earned. */
export interface AchievementsResponse {
  achievements: {
    id: string;
    icon: string;
    kind: 'permanent' | 'season';
    condition: AchievementCondition;
    reward: { money?: Partial<Record<Currency, number>> | undefined; exp?: number | undefined };
    /** Earned once for permanent ones; once per season for season medals. */
    earned: { at: string; season: string | null }[];
    /** Share of players who have it, in basis points (rarer medals are shown first). */
    holdersBp: number;
  }[];
  /** D-137: the ids shown in the rating, and whether the player chose them. */
  shown: string[];
  chosen: boolean;
}

// ─── Mini-games (D-169) ─────────────────────────────────────────────────────

export interface MiniGameWallet {
  currency: Currency;
  balance: number;
  minBet: number;
  /** maxBetShareBp of the balance, rounded down. */
  maxBet: number;
}

export interface MinesRoundView {
  id: string;
  status: 'active' | 'finished' | 'expired';
  currency: string;
  bet: number;
  difficulty: MiniGameDifficulty;
  cells: number;
  mines: number;
  /** Opened safe cells in order. */
  opened: number[];
  /** The «SpinCards» cell once opened, or at the end of the round. */
  bonusCell: number | null;
  bonusFound: boolean;
  multiplierBp: number;
  /** After one more safe cell; null when no safe cell is left. */
  nextMultiplierBp: number | null;
  /** Chance that the next cell is safe. */
  safeChanceBp: number;
  /** The mine that ended the round. */
  exploded: number | null;
  /** All mines, shown when the round is over. */
  minesAt: number[] | null;
  payout: number;
}

export interface BlackjackRoundView {
  id: string;
  status: 'active' | 'finished' | 'expired';
  currency: string;
  /** Total stake, a double included. */
  bet: number;
  /** Cards 0..51: rank = card % 13 (0 = ace), suit = floor(card / 13). */
  player: number[];
  /** Only the open card while the round is active. */
  dealer: number[];
  playerTotal: number;
  dealerTotal: number | null;
  canDouble: boolean;
  outcome: 'blackjack' | 'win' | 'push' | 'lose' | null;
  payout: number;
}

/** Closed while the flag `minigames_enabled` is off or the active config has no mini-games. */
export type MiniGamesInfo = { enabled: false } | MiniGamesOpenInfo;

export interface MiniGamesOpenInfo {
  enabled: true;
  maxBetShareBp: number;
  wallets: MiniGameWallet[];
  mines: {
    houseEdgeBp: number;
    bonusBp: number;
    difficulties: { id: MiniGameDifficulty; cells: number; minMines: number; maxMines: number }[];
  };
  plinko: {
    maxBalls: number;
    difficulties: { id: MiniGameDifficulty; rows: number; multipliersBp: number[] }[];
  };
  coinflip: { payoutBp: number };
  blackjack: { blackjackPayoutBp: number; decks: number };
  active: { mines: MinesRoundView | null; blackjack: BlackjackRoundView | null };
}

export interface MiniGameBet {
  currency: Currency;
  bet: number;
  idempotencyKey: string;
}

export interface MinesStartRequest extends MiniGameBet {
  difficulty: MiniGameDifficulty;
  mines: number;
}

export interface MinesOpenRequest {
  roundId: string;
  cell: number;
  idempotencyKey: string;
}

export interface MiniGameRoundRequest {
  roundId: string;
  idempotencyKey: string;
}

export interface MinesResponse {
  round: MinesRoundView;
  wallet: WalletBalance;
}

export interface PlinkoRequest {
  currency: Currency;
  betPerBall: number;
  balls: number;
  difficulty: MiniGameDifficulty;
  idempotencyKey: string;
}

export interface PlinkoResponse {
  roundId: string;
  rows: number;
  balls: { path: number[]; cup: number; multiplierBp: number; payout: number }[];
  bet: number;
  payout: number;
  wallet: WalletBalance;
}

export type CoinSide = 'heads' | 'tails';

export interface CoinflipRequest extends MiniGameBet {
  side: CoinSide;
}

export interface CoinflipResponse {
  roundId: string;
  side: CoinSide;
  result: CoinSide;
  bet: number;
  payout: number;
  wallet: WalletBalance;
}

export type BlackjackStartRequest = MiniGameBet;

export interface BlackjackActRequest extends MiniGameRoundRequest {
  action: 'hit' | 'stand' | 'double';
}

export interface BlackjackResponse {
  round: BlackjackRoundView;
  wallet: WalletBalance;
}
