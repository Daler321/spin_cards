/**
 * Error codes returned by the API. Clients translate them via the `errors` i18n namespace.
 * Add new codes here and a matching key in every locale's errors.json.
 */
export const ErrorCode = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  MAINTENANCE: 'MAINTENANCE',
  /** The server is shedding load; the request was not processed and may be resent as is. */
  OVERLOADED: 'OVERLOADED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  CARD_EXPIRED: 'CARD_EXPIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  INVALID_INIT_DATA: 'INVALID_INIT_DATA',
  INIT_DATA_EXPIRED: 'INIT_DATA_EXPIRED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  USER_BANNED: 'USER_BANNED',
  CURRENCY_NOT_SUPPORTED: 'CURRENCY_NOT_SUPPORTED',
  CONVERSION_BELOW_MINIMUM: 'CONVERSION_BELOW_MINIMUM',
  CONVERSION_LIMIT_EXCEEDED: 'CONVERSION_LIMIT_EXCEEDED',
  PACK_NOT_AVAILABLE: 'PACK_NOT_AVAILABLE',
  PACK_LOCKED: 'PACK_LOCKED',
  NO_FREE_SPINS: 'NO_FREE_SPINS',
  CARD_DECISION_PENDING: 'CARD_DECISION_PENDING',
  CARD_NOT_FOUND: 'CARD_NOT_FOUND',
  CARD_NOT_USABLE: 'CARD_NOT_USABLE',
  /** The card paid for its limit of spins in the current window (D-121). */
  CARD_SPIN_LIMIT: 'CARD_SPIN_LIMIT',
  /** No free album slot (D-129). */
  ALBUM_FULL: 'ALBUM_FULL',
  P2P_RECIPIENT_NOT_FOUND: 'P2P_RECIPIENT_NOT_FOUND',
  P2P_LEVEL_TOO_LOW: 'P2P_LEVEL_TOO_LOW',
  P2P_BELOW_MINIMUM: 'P2P_BELOW_MINIMUM',
  P2P_LIMIT_EXCEEDED: 'P2P_LIMIT_EXCEEDED',
  /** A text override uses placeholders the default text does not have (D-134). */
  TEXT_PLACEHOLDER_INVALID: 'TEXT_PLACEHOLDER_INVALID',
  QUEST_NOT_COMPLETED: 'QUEST_NOT_COMPLETED',
  QUEST_ALREADY_CLAIMED: 'QUEST_ALREADY_CLAIMED',
  CARD_NOT_EXTENDABLE: 'CARD_NOT_EXTENDABLE',
  CARD_NOT_RESTORABLE: 'CARD_NOT_RESTORABLE',
  HOLDER_FULL: 'HOLDER_FULL',
  HOLDER_LOCKED: 'HOLDER_LOCKED',
  HOLDER_ALREADY_OWNED: 'HOLDER_ALREADY_OWNED',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  DAILY_ALREADY_CLAIMED: 'DAILY_ALREADY_CLAIMED',
  NO_CHEST_AVAILABLE: 'NO_CHEST_AVAILABLE',
  CHEST_MAX_LEVEL: 'CHEST_MAX_LEVEL',
  WHEEL_NOT_READY: 'WHEEL_NOT_READY',
  BUFF_ALREADY_ACTIVE: 'BUFF_ALREADY_ACTIVE',
  SHOP_DAILY_LIMIT: 'SHOP_DAILY_LIMIT',
  PAYMENTS_DISABLED: 'PAYMENTS_DISABLED',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  PAYMENT_INVALID: 'PAYMENT_INVALID',
  WHEEL_ALREADY_READY: 'WHEEL_ALREADY_READY',
  PAYMENT_NOT_REFUNDABLE: 'PAYMENT_NOT_REFUNDABLE',
  ADMIN_INVALID_CREDENTIALS: 'ADMIN_INVALID_CREDENTIALS',
  ADMIN_TOTP_INVALID: 'ADMIN_TOTP_INVALID',
  ADMIN_LOCKED: 'ADMIN_LOCKED',
  /** An admin with this login already exists. */
  ADMIN_LOGIN_TAKEN: 'ADMIN_LOGIN_TAKEN',
  CONFIG_INVALID: 'CONFIG_INVALID',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  /** The channel quest: Telegram does not see the player in the channel (D-157). */
  CHANNEL_NOT_JOINED: 'CHANNEL_NOT_JOINED',
  CONFIG_NOT_EDITABLE: 'CONFIG_NOT_EDITABLE',
  CONFIG_NOT_SIMULATED: 'CONFIG_NOT_SIMULATED',
  /** D-169: a mini-game bet above maxBetShareBp of the wallet. */
  MINIGAME_BET_TOO_HIGH: 'MINIGAME_BET_TOO_HIGH',
  MINIGAME_BET_TOO_LOW: 'MINIGAME_BET_TOO_LOW',
  /** A mines or 21 round is still open: finish it first. */
  MINIGAME_ROUND_ACTIVE: 'MINIGAME_ROUND_ACTIVE',
  MINIGAME_ROUND_OVER: 'MINIGAME_ROUND_OVER',
  /** The cell is already open, a double after the third card and the like. */
  MINIGAME_INVALID_MOVE: 'MINIGAME_INVALID_MOVE',
  /** D-170: craft needs N held, active cards of one tier and currency below Mythic. */
  CRAFT_INVALID_CARDS: 'CRAFT_INVALID_CARDS',
  /** D-171: Mythic cards cannot go up, or the number is taken in the higher tier. */
  CARD_NOT_UPGRADABLE: 'CARD_NOT_UPGRADABLE',
  /** D-172: the album income is not ready yet, or the album is empty. */
  ALBUM_INCOME_NOT_READY: 'ALBUM_INCOME_NOT_READY',
  /** D-173: the tag is not in the Telegram name, or the bonus was claimed within claimHours. */
  NICK_TAG_MISSING: 'NICK_TAG_MISSING',
  NICK_BONUS_NOT_READY: 'NICK_BONUS_NOT_READY',
  /** D-174: nothing to collect (no other card has money). */
  NOTHING_TO_COLLECT: 'NOTHING_TO_COLLECT',
  /** D-177: no visible player with this @username. */
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    requestId?: string;
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ErrorCode, value);
}
