/**
 * Contract of the internal bot routes (`/internal/bot/*`, TZ 11.2). Only the bot calls them, with
 * the internal token; they are not reachable through the public proxy.
 */

/** Telegram profile as the bot sees it (no photo: the Mini App sends that on sign-in). */
export interface BotUserProfile {
  telegramId: string;
  firstName: string;
  lastName?: string | undefined;
  username?: string | undefined;
  languageCode?: string | undefined;
}

export interface BotStartRequest {
  user: BotUserProfile;
  /** Deep-link payload of /start, e.g. `ref_ABCD2345`. */
  payload?: string | undefined;
}

export interface BotStartResponse {
  isNew: boolean;
  notificationsEnabled: boolean;
  /** For the /ref link (D-145). */
  referralCode: string;
}

/** D-145: a new post in a channel where the bot is an admin. */
export interface BotChannelPostRequest {
  chatId: string;
  chatUsername?: string | undefined;
  messageId: number;
}

export interface BotChannelPostResponse {
  /** Players the post was queued for (0: not a required channel, or the option is off). */
  queued: number;
}

export interface BotSettingsRequest {
  telegramId: string;
  notificationsEnabled: boolean;
}

/** my_chat_member: the player blocked (or unblocked) the bot. */
export interface BotChatStatusRequest {
  telegramId: string;
  blocked: boolean;
}

export const NOTIFICATION_KINDS = [
  'free_spin_ready',
  'card_expiring',
  'referral_reward',
  'comeback',
  'season_result',
  'p2p_received',
  'broadcast',
  'channel_post',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A message due now; the bot renders it with i18n (`bot:notify.<kind>`) and sends it. */
export interface ClaimedNotification {
  id: string;
  kind: NotificationKind;
  telegramId: string;
  languageCode: string | null;
  /** Interpolation values (amounts already in minor units with their currency). */
  params: Record<string, string | number>;
  /** Broadcast text as written by the admin (kind `broadcast` only). */
  text?: string | undefined;
}

export interface ClaimNotificationsResponse {
  items: ClaimedNotification[];
  /** Send rate the bot keeps (messages per second, from the game config). */
  perSecond: number;
}

export type NotificationOutcome = 'sent' | 'failed' | 'blocked';

export interface NotificationResultRequest {
  outcome: NotificationOutcome;
  /** Telegram error description, without user data. */
  error?: string | undefined;
  /** Telegram asked to wait (429): retry after this many seconds. */
  retryAfterSec?: number | undefined;
}

/** pre_checkout_query: the invoice payload is our payment id. */
export interface PreCheckoutRequest {
  telegramId: string;
  payload: string;
  currency: string;
  totalAmount: number;
}

export interface PreCheckoutResponse {
  ok: boolean;
  /** Error code for the player when not ok (translated by the bot). */
  error?: string | undefined;
}

export interface SuccessfulPaymentRequest {
  telegramId: string;
  payload: string;
  currency: string;
  totalAmount: number;
  telegramPaymentChargeId: string;
}

export interface SuccessfulPaymentResponse {
  /** False when this charge was already credited (Telegram re-delivered the update). */
  credited: boolean;
  productId: string;
  /** D-146: the product could not be given any more, the Stars went back to the player. */
  refunded?: boolean;
}
