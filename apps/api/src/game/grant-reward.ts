import { accrueFreeSpins, scaleRewardMoney } from '@spincards/game-core';
import type { Currency, GameConfig, Tier } from '@spincards/shared';
import { LedgerAccountType, type LedgerReason, type User } from '../generated/prisma/client.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { Tx } from '../prisma/prisma.service.js';

/** Anything a bonus can give (daily, chest, wheel share this shape). */
export interface Reward {
  money?: Partial<Record<Currency, number>> | undefined;
  /** D-147: +points of luck for the next spins. */
  luck?: { points: number; spins: number } | undefined;
  freeSpins?: number | undefined;
  guaranteedFloor?: Tier | undefined;
  chest?: boolean | undefined;
}

export interface GrantContext {
  tx: Tx;
  user: User;
  config: GameConfig;
  seasonId: string;
  reason: LedgerReason;
  ref: { type: string; id: string };
  buffSource: string;
  /** Money already scaled for the level (daily rewards scale on their own, D-113). */
  moneyScaled?: boolean;
}

/**
 * Applies a reward: money (scaled by player level) to the wallet of the current region via the
 * ledger, luck points for the next spins (D-147), free spins (may exceed the cap), a tier guarantee for the next
 * spin, or an extra chest. Returns the money credited, if any.
 */
export async function grantReward(
  ledger: LedgerService,
  reward: Reward,
  ctx: GrantContext,
): Promise<{ currency: string; amount: number } | null> {
  const { tx, user, config } = ctx;
  const currency = config.regions[user.region].currency;
  const base = reward.money?.[currency];
  let credited: { currency: string; amount: number } | null = null;
  if (base) {
    const amount = ctx.moneyScaled ? base : scaleRewardMoney(base, user.level, config);
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency } },
    });
    await ledger.post(
      tx,
      [
        {
          account: { type: LedgerAccountType.wallet, id: wallet.id },
          delta: BigInt(amount),
          reason: ctx.reason,
          ref: ctx.ref,
        },
      ],
      { seasonId: ctx.seasonId },
    );
    credited = { currency, amount };
  }
  if (reward.luck) {
    await tx.userBuff.create({
      data: {
        userId: user.id,
        luckPoints: reward.luck.points,
        spinsLeft: reward.luck.spins,
        source: ctx.buffSource,
      },
    });
  }
  const data: {
    freeSpinsAvailable?: number;
    freeSpinsAnchorAt?: Date;
    guaranteedFloor?: Tier;
    chestSpinsUsed?: number;
  } = {};
  if (reward.freeSpins) {
    const free = accrueFreeSpins(
      { available: user.freeSpinsAvailable, anchorAt: user.freeSpinsAnchorAt },
      new Date(),
      config,
    );
    data.freeSpinsAvailable = free.available + reward.freeSpins;
    data.freeSpinsAnchorAt = free.anchorAt;
  }
  if (reward.guaranteedFloor) data.guaranteedFloor = reward.guaranteedFloor;
  // An extra chest: one period of spins given back (the stock cap still applies).
  if (reward.chest) data.chestSpinsUsed = user.chestSpinsUsed - config.chest.everySpins;
  if (Object.keys(data).length > 0) await tx.user.update({ where: { id: user.id }, data });
  return credited;
}
