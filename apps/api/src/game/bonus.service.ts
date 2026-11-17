import { HttpStatus, Injectable } from '@nestjs/common';
import {
  accrueFreeSpins,
  chestState,
  spinsUsedAfterOpening,
  isWheelAvailable,
  nextFreeSpinAt,
  rollChestReward,
  rollWheel,
  wheelAvailableAt,
} from '@spincards/game-core';
import {
  type ChestClaimResponse,
  type ChestUpgradeResponse,
  type ChestView,
  type Currency,
  ErrorCode,
  type GameConfig,
  type ShopBuyRequest,
  type ShopBuyResponse,
  type WheelSpinResponse,
} from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason, type User } from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, LedgerService } from '../ledger/ledger.service.js';
import { activeBuffsWhere, buffView } from './buffs.js';
import { grantReward } from './grant-reward.js';
import { cryptoRng } from './crypto-rng.js';
import { lockPlayer } from './player-lock.js';
import { QuestsService } from './quests.service.js';

export function chestView(
  user: Pick<User, 'totalSpins' | 'chestSpinsUsed' | 'chestLevel'>,
  config: GameConfig,
): ChestView {
  return { ...chestState(user.totalSpins, user.chestSpinsUsed, config), level: user.chestLevel };
}

@Injectable()
export class BonusService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
    private readonly quests: QuestsService,
  ) {}

  /** Opens one chest earned by spins (TZ 8); rewards depend on the chest level. */
  async claimChest(userId: string, idempotencyKey: string): Promise<ChestClaimResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'bonus.chest', payload: {} },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (chestState(user.totalSpins, user.chestSpinsUsed, config).available < 1) {
          throw new AppError(ErrorCode.NO_CHEST_AVAILABLE, HttpStatus.CONFLICT);
        }
        const chestSpinsUsed = spinsUsedAfterOpening(user.totalSpins, user.chestSpinsUsed, config);
        await tx.user.update({ where: { id: userId }, data: { chestSpinsUsed } });
        const { weight: _weight, ...reward } = rollChestReward(cryptoRng, config, user.chestLevel);
        const credited = await grantReward(this.ledger, reward, {
          tx,
          user: { ...user, chestSpinsUsed },
          config,
          seasonId,
          reason: LedgerReason.chest,
          ref: { type: 'chest', id: `${userId}:${String(chestSpinsUsed)}` },
          buffSource: 'chest',
        });
        await this.quests.record(tx, user, [{ type: 'chest' }], {
          config,
          seasonId,
          now: new Date(),
        });
        return { reward, credited, chest: chestView({ ...user, chestSpinsUsed }, config) };
      },
    );
  }

  /** Upgrades the chest one level for currency (Stars later, behind stars_enabled). */
  async upgradeChest(
    userId: string,
    currency: Currency,
    idempotencyKey: string,
  ): Promise<ChestUpgradeResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'bonus.chest.upgrade', payload: { currency } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const next = config.chest.levels.find((l) => l.level === user.chestLevel + 1);
        if (!next) throw new AppError(ErrorCode.CHEST_MAX_LEVEL, HttpStatus.CONFLICT);
        const price = next.upgradePrice?.[currency];
        if (price === undefined) throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency } },
        });
        const walletRef = { type: LedgerAccountType.wallet, id: wallet.id };
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: walletRef,
              delta: -BigInt(price),
              reason: LedgerReason.shop,
              ref: { type: 'chest_level', id: String(next.level) },
            },
          ],
          { seasonId },
        );
        await tx.user.update({ where: { id: userId }, data: { chestLevel: next.level } });
        return {
          chest: chestView({ ...user, chestLevel: next.level }, config),
          wallet: { currency, balance: toApiMoney(balances.get(accountKey(walletRef)) ?? 0n) },
        };
      },
    );
  }

  /** Free wheel of fortune every few hours; the server picks the segment before the animation. */
  async spinWheel(userId: string, idempotencyKey: string): Promise<WheelSpinResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'bonus.wheel', payload: {} },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const now = new Date();
        if (!isWheelAvailable(user.wheelSpunAt, now, config)) {
          throw new AppError(ErrorCode.WHEEL_NOT_READY, HttpStatus.CONFLICT);
        }
        await tx.user.update({ where: { id: userId }, data: { wheelSpunAt: now } });
        const segmentIndex = rollWheel(cryptoRng, config);
        const { weight: _weight, ...segment } = config.wheel.segments[
          segmentIndex
        ] as GameConfig['wheel']['segments'][number];
        const credited = await grantReward(this.ledger, segment, {
          tx,
          user,
          config,
          seasonId,
          reason: LedgerReason.wheel,
          ref: { type: 'wheel', id: `${userId}:${now.toISOString()}` },
          buffSource: 'wheel',
        });
        await this.quests.record(tx, user, [{ type: 'wheel' }], { config, seasonId, now });
        return {
          segmentIndex,
          segmentId: segment.id,
          reward: segment,
          credited,
          availableAt: (wheelAvailableAt(now, config) as Date).toISOString(),
        };
      },
    );
  }

  /**
   * Shop (TZ 8): fixed-price free spin bundles, and luck buffs for one pack priced from that pack
   * (price = pack price × spins × pricePerSpinBp). Shop buffs do not stack per pack and are limited
   * per UTC day.
   */
  async buy(userId: string, request: ShopBuyRequest): Promise<ShopBuyResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'shop.buy', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const item = config.shop.items.find((i) => i.id === payload.itemId);
        // D-147: luck is no longer sold for game money (Stars multipliers only).
        if (!item && config.shop.buffs.some((b) => b.id === payload.itemId))
          throw new AppError(ErrorCode.NOT_AVAILABLE, HttpStatus.CONFLICT);
        if (!item) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
        const price = item.prices[payload.currency];
        if (price === undefined) throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED);

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency: payload.currency } },
        });
        const walletRef = { type: LedgerAccountType.wallet, id: wallet.id };
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: walletRef,
              delta: -BigInt(price),
              reason: LedgerReason.shop,
              ref: { type: 'shop_item', id: payload.itemId },
            },
          ],
          { seasonId },
        );
        let free = accrueFreeSpins(
          { available: user.freeSpinsAvailable, anchorAt: user.freeSpinsAnchorAt },
          new Date(),
          config,
        );
        free = { ...free, available: free.available + item.freeSpins };
        await tx.user.update({
          where: { id: userId },
          data: { freeSpinsAvailable: free.available, freeSpinsAnchorAt: free.anchorAt },
        });
        const buffs = await tx.userBuff.findMany({
          where: activeBuffsWhere(userId, new Date()),
          orderBy: { createdAt: 'asc' },
        });
        return {
          itemId: payload.itemId,
          wallet: {
            currency: wallet.currency,
            balance: toApiMoney(balances.get(accountKey(walletRef)) ?? 0n),
          },
          freeSpins: {
            available: free.available,
            nextAt: nextFreeSpinAt(free, config)?.toISOString() ?? null,
          },
          buffs: buffs.map(buffView),
        };
      },
    );
  }
}
