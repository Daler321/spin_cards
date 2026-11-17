/** Admin panel API (`/admin/*` on the api, `/api/admin/*` through the proxy; TZ 11.3, 15). */
import type { BuffView } from './api.js';
import type { EditableTextKey, BotOptions, StartLinkButton } from './texts.js';

export const ADMIN_ROLES = ['owner', 'analyst', 'support'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminLoginRequest {
  login: string;
  password: string;
  /** Required once TOTP is set up. */
  totp?: string | undefined;
}

/** Login either signs in, asks for the TOTP code, or starts the TOTP setup (first login). */
export type AdminLoginResponse =
  | { stage: 'done'; admin: AdminMe }
  | { stage: 'totp_required' }
  | { stage: 'totp_setup'; setupToken: string; secret: string; otpauthUrl: string };

export interface AdminTotpSetupRequest {
  setupToken: string;
  code: string;
}

export interface AdminMe {
  id: string;
  login: string;
  role: AdminRole;
}

export interface AdminUserListItem {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  level: number;
  region: string;
  isBanned: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface AdminLedgerItem {
  id: string;
  accountType: string;
  accountId: string;
  currency: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  exp: number;
  totalSpins: number;
  referralCode: string;
  referrerId: string | null;
  notificationsEnabled: boolean;
  hideFromLeaderboard: boolean;
  botBlockedAt: string | null;
  experimentGroup: string | null;
  wallets: { currency: string; balance: number }[];
  cards: {
    id: string;
    number: string;
    tier: string;
    status: string;
    balance: number;
    currency: string;
    held: boolean;
    expiresAt: string;
  }[];
  buffs: (BuffView & { source: string })[];
  ledger: AdminLedgerItem[];
  spins: { id: string; packId: string; price: number; currency: string; createdAt: string }[];
  referrals: { id: string; firstName: string; status: string; createdAt: string }[];
}

export interface AdminBanRequest {
  banned: boolean;
  reason: string;
}

export interface AdminAdjustRequest {
  currency: string;
  /** Signed amount in minor units. */
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export interface AdminBuffRequest {
  /** D-147: luck points added for the next spins. */
  points: number;
  spins: number;
  reason: string;
}

export type BroadcastSegment = 'all' | 'active' | 'inactive';

export interface AdminBroadcastRequest {
  text: string;
  segment: BroadcastSegment;
  days?: number | undefined;
}

export interface AdminBroadcastItem {
  id: string;
  text: string;
  segment: BroadcastSegment;
  segmentDays: number | null;
  recipients: number;
  createdBy: string;
  createdAt: string;
  sent: number;
  pending: number;
  failed: number;
}

export interface AdminPoolResponse {
  total: number;
  byTier: { tier: string; region: string; count: number }[];
  oldest: {
    id: string;
    number: string;
    tier: string;
    region: string;
    ownersCount: number;
    pooledAt: string | null;
  }[];
}

export interface AdminFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AdminAuditItem {
  id: string;
  actorType: string;
  actorId: string | null;
  /** Admin login when the actor is an admin account. */
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  payload: unknown;
  createdAt: string;
}

export interface AdminPaymentItem {
  id: string;
  userId: string;
  productId: string;
  status: string;
  starsAmount: number;
  telegramPaymentChargeId: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface AdminSeasonItem {
  id: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
}

/** Cursor pagination: pass `nextCursor` back as `cursor`. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── Configs (TZ 15.2) ──────────────────────────────────────────────────────

export type ConfigStatus = 'draft' | 'simulated' | 'active' | 'archived';

export interface AdminConfigVersion {
  id: number;
  status: ConfigStatus;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
  activatedAt: string | null;
  /** Simulation verdict, null when not simulated. */
  simulationOk: boolean | null;
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export interface ConfigDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

/** One simulated pack and region (subset of game-core's report). */
export interface ConfigSimulationItem {
  packId: string;
  region: string;
  /**
   * D-141: `regular` — a mix of wallet and held-card payments at level 1; `bestCard` — every spin
   * paid with a card at the luck cap at simulation.bestCardLevel, as players do with their best card.
   */
  scenario: 'regular' | 'bestCard';
  currency: string;
  spins: number;
  rtpBp: number | null;
  inCorridor: boolean;
  tiers: Record<string, { actualBp: number; configuredBp: number }>;
  nearMissShareBp: number;
  patternedShareBp: number;
}

export interface ConfigSimulationReport {
  ok: boolean;
  ranAt: string;
  spinsPerPack: number;
  corridor: { minBp: number; maxBp: number };
  items: ConfigSimulationItem[];
  /** D-169: absent in reports made before the mini-games. */
  minigames?: ConfigMiniGameReturn[]; /** D-170: the average new card's balance against the craft fee, per input tier. */
  craft?: ConfigCraftReturn[];
}

export interface ConfigCraftReturn {
  tier: string;
  currency: string;
  returnBp: number;
  inCorridor: boolean;
}

export interface ConfigMiniGameReturn {
  game: string;
  difficulty: string | null;
  minBp: number;
  maxBp: number;
  inCorridor: boolean;
}

export interface AdminConfigDetail extends AdminConfigVersion {
  payload: unknown;
  simulation: ConfigSimulationReport | null;
}

export interface AdminConfigDraftRequest {
  payload: unknown;
  comment: string;
}

export interface AdminExperiment {
  group: string;
  versionId: number;
  users: number;
}

// ─── Dashboard (TZ 15.1) ────────────────────────────────────────────────────

export interface AdminStatRow {
  date: string;
  metric: string;
  dimension: string;
  /** Decimal string (BIGINT). */
  value: string;
}

export interface AdminAlert {
  id: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

// ─── Settings (D-110) ───────────────────────────────────────────────────────

export interface AdminSubscriptionSettings {
  enabled: boolean;
  channels: { chatId: string; title: string; url: string }[];
}

/** Whether the bot can check members of a channel (it must be an admin there). */
export interface AdminChannelCheck {
  chatId: string;
  ok: boolean;
  /** Telegram's answer when not ok. */
  error: string | null;
}

/** The quiet channel line appended to shared card messages (D-114). */
export interface AdminShareSettings {
  adText: string;
  /** Optional t.me link for the channel line. */
  adUrl: string;
}

/** Owner settings of operational alerts (D-117). */
export interface AdminOpsSettings {
  /** Telegram chat ids (users or groups) that receive alerts from the bot. */
  alertChatIds: string[];
}

export interface OpsRunStatus {
  at: string;
  ok: boolean;
  /** Backup file name or the dump that was restored. */
  file?: string;
  sizeBytes?: number;
  durationMs?: number;
  /** Restore check: accounts restored and ledger mismatches found. */
  accounts?: number;
  mismatches?: number;
  error?: string;
}

export interface AdminOpsStatus {
  backupsEnabled: boolean;
  backup: OpsRunStatus | null;
  restoreCheck: OpsRunStatus | null;
  /** Disk of the backup folder; null when backups are off. */
  disk: { freeBytes: number; totalBytes: number } | null;
  /** Latest dumps, newest first. */
  files: { name: string; sizeBytes: number; at: string }[];
}

export interface AdminOpsTestResult {
  chatId: string;
  ok: boolean;
  error: string | null;
}

/** Why a player is on the "suspicious" list (D-119); signals for a human, never an auto-ban. */
export type AdminFraudSignalKind = 'spins' | 'referrals' | 'sharedIp' | 'commissionCap' | 'p2pIn';

export interface AdminFraudEntry {
  userId: string;
  firstName: string;
  username: string | null;
  level: number;
  isBanned: boolean;
  /** `value`: spins in the last hour, referrals in 24 h, players on the same IP, or 1. */
  signals: { kind: AdminFraudSignalKind; value: number }[];
}

/** An admin panel account as the owner sees it (D-120). */
export interface AdminAccount {
  id: string;
  login: string;
  role: AdminRole;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** D-134: editable texts with their defaults and current overrides. */
export interface AdminTextsResponse {
  items: {
    key: EditableTextKey;
    group: 'miniApp' | 'bot';
    defaultText: string;
    override: string | null;
  }[];
  startLink: StartLinkButton | null;
  bot: BotOptions;
}
