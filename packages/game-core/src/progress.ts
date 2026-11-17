import type { ChestLevel, ChestReward, DailyReward, GameConfig } from '@spincards/shared';
import { BP, mulDivFloor, pickWeighted } from './math.js';
import type { Rng } from './ports.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ─── Free spins (TZ 5.7) ────────────────────────────────────────────────────

export interface FreeSpinState {
  available: number;
  /** Start of the interval currently accruing the next free spin. */
  anchorAt: Date;
}

/**
 * Accrues one free spin per interval while below maxStored. Bonus spins (e.g. daily rewards) may
 * push the stock above the cap; accrual just pauses until it drops below again.
 */
export function accrueFreeSpins(
  state: FreeSpinState,
  now: Date,
  config: GameConfig,
): FreeSpinState {
  const { intervalHours, maxStored } = config.freeSpins;
  if (state.available >= maxStored) return { available: state.available, anchorAt: now };
  const intervalMs = intervalHours * HOUR_MS;
  const accrued = Math.max(0, Math.floor((now.getTime() - state.anchorAt.getTime()) / intervalMs));
  const available = Math.min(maxStored, state.available + accrued);
  const anchorAt =
    available >= maxStored ? now : new Date(state.anchorAt.getTime() + accrued * intervalMs);
  return { available, anchorAt };
}

/** When the next free spin accrues, or null if the stock is full. */
export function nextFreeSpinAt(state: FreeSpinState, config: GameConfig): Date | null {
  if (state.available >= config.freeSpins.maxStored) return null;
  return new Date(state.anchorAt.getTime() + config.freeSpins.intervalHours * HOUR_MS);
}

// ─── Levels (TZ 7.2) ────────────────────────────────────────────────────────

export function levelForExp(exp: number, config: GameConfig): number {
  let level = 1;
  for (const entry of config.levels) if (exp >= entry.exp) level = entry.level;
  return level;
}

// ─── Daily streak (TZ 8) ────────────────────────────────────────────────────

export interface DailyState {
  streak: number;
  /** UTC calendar day of the last claim. */
  lastClaimDay: Date | null;
  forgivenessUsedDay: Date | null;
}

export type DailyClaim =
  | { ok: false; reason: 'already_claimed' }
  | {
      ok: true;
      /** 1-based day of the streak being rewarded. */
      day: number;
      reward: DailyReward;
      forgiven: boolean;
      state: DailyState;
    };

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Claims today's reward. Consecutive days continue the streak; missing exactly one day is forgiven
 * once per forgiveness window; otherwise the streak restarts. After the last reward it starts over.
 */
export function claimDaily(state: DailyState, now: Date, config: GameConfig): DailyClaim {
  const today = utcDay(now);
  const { rewards, forgivenessWindowDays } = config.daily;
  if (state.lastClaimDay && utcDay(state.lastClaimDay).getTime() === today.getTime()) {
    return { ok: false, reason: 'already_claimed' };
  }

  const gapDays = state.lastClaimDay
    ? Math.round((today.getTime() - utcDay(state.lastClaimDay).getTime()) / DAY_MS)
    : Infinity;
  const forgivenessAvailable =
    !state.forgivenessUsedDay ||
    (today.getTime() - utcDay(state.forgivenessUsedDay).getTime()) / DAY_MS >=
      forgivenessWindowDays;
  const forgiven = gapDays === 2 && forgivenessAvailable;
  const continues = gapDays === 1 || forgiven;

  const previous = continues ? state.streak % rewards.length : 0;
  const day = previous + 1;
  return {
    ok: true,
    day,
    reward: rewards[day - 1] as DailyReward,
    forgiven,
    state: {
      streak: day,
      lastClaimDay: today,
      forgivenessUsedDay: forgiven ? today : state.forgivenessUsedDay,
    },
  };
}

// ─── Card lifecycle (TZ 6) ──────────────────────────────────────────────────

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

/** Extension: +extendLifespanBp of the original lifespan (the price is lifecyclePrices, D-115). */
export function extensionHours(lifespanHours: number, config: GameConfig): number {
  return mulDivFloor(lifespanHours, config.lifecycle.extendLifespanBp, BP);
}

// ─── Chests (TZ 8) ──────────────────────────────────────────────────────────

export interface ChestState {
  /** Chests ready to open (capped at maxStored). */
  available: number;
  /** Spins made towards the next chest. */
  progress: number;
  everySpins: number;
}

/**
 * Chest stock (TZ 8): counted in spins, not chests (D-112). `spinsUsed` is how many of the player's
 * spins have already turned into chests (opened or forfeited), so changing `everySpins` in the config
 * never strands a player. Every `everySpins` unused spins make a chest, up to `maxStored`.
 */
export function chestState(totalSpins: number, spinsUsed: number, config: GameConfig): ChestState {
  const { everySpins, maxStored } = config.chest;
  const unused = Math.max(0, totalSpins - spinsUsed);
  return {
    available: Math.min(maxStored, Math.floor(unused / everySpins)),
    progress: unused % everySpins,
    everySpins,
  };
}

/**
 * Spins used after opening one chest. Chests beyond the cap are forfeited first (their spins
 * count as used), so at most `maxStored - 1` stay unopened; progress towards the next is kept.
 */
export function spinsUsedAfterOpening(
  totalSpins: number,
  spinsUsed: number,
  config: GameConfig,
): number {
  const { everySpins, maxStored } = config.chest;
  const earned = Math.floor(Math.max(0, totalSpins - spinsUsed) / everySpins);
  return spinsUsed + (Math.max(0, earned - maxStored) + 1) * everySpins;
}

export function chestLevelConfig(level: number, config: GameConfig): ChestLevel {
  const levels = config.chest.levels;
  return levels.find((l) => l.level === level) ?? (levels[0] as ChestLevel);
}

export function rollChestReward(rng: Rng, config: GameConfig, chestLevel = 1): ChestReward {
  return pickWeighted(
    rng,
    chestLevelConfig(chestLevel, config).rewards.map((reward): [ChestReward, number] => [
      reward,
      reward.weight,
    ]),
  );
}

// ─── Level scaling of rewards ───────────────────────────────────────────────

/** Money rewards (daily, chest, wheel) grow by rewardLevelBonusBp per player level above 1. */
export function scaleRewardMoney(amount: number, playerLevel: number, config: GameConfig): number {
  return mulDivFloor(amount, BP + Math.max(0, playerLevel - 1) * config.rewardLevelBonusBp, BP);
}

// ─── Wheel of fortune ───────────────────────────────────────────────────────

/** When the wheel is free again; null last spin means it is available now. */
export function wheelAvailableAt(lastSpunAt: Date | null, config: GameConfig): Date | null {
  return lastSpunAt ? new Date(lastSpunAt.getTime() + config.wheel.intervalHours * HOUR_MS) : null;
}

export function isWheelAvailable(lastSpunAt: Date | null, now: Date, config: GameConfig): boolean {
  const at = wheelAvailableAt(lastSpunAt, config);
  return !at || at <= now;
}

/** Index of the winning segment, picked by weight (odds are published). */
export function rollWheel(rng: Rng, config: GameConfig): number {
  return pickWeighted(
    rng,
    config.wheel.segments.map((segment, index): [number, number] => [index, segment.weight]),
  );
}

// ─── Collection level ───────────────────────────────────────────────────────

export function collectionLevel(
  score: number,
  config: GameConfig,
): { level: number; nextLevelScore: number | null } {
  const levels = config.collectionLevels;
  let level = 1;
  levels.forEach((threshold, i) => {
    if (score >= threshold) level = i + 1;
  });
  return { level, nextLevelScore: levels[level] ?? null };
}
