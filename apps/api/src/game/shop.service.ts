import { HttpStatus, Injectable } from '@nestjs/common';
import { claimDaily, levelForExp, utcDay } from '@spincards/game-core';
import { type Currency, ErrorCode, scaleDailyReward } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CardsService } from './cards.service.js';
import { grantReward } from './grant-reward.js';
import { QuestsService } from './quests.service.js';
import { lockPlayer } from './player-lock.js';
import { ReferralService } from './referral.service.js';
import type { BuyHolderResponse, DailyClaimResponse } from '@spincards/shared';

export interface BuyHolderRequest {
  holderId: string;
  payWith: Currency | 'stars';
  idempotencyKey: string;
}

@Injectable()
export class ShopService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
    private readonly cards: CardsService,
    private readonly referrals: ReferralService,
    private readonly quests: QuestsService,
  ) {}

  /** Holders stack their slots; currency purchases unlock by level, Stars purchases come with M9. */
  async buyHolder(userId: string, request: BuyHolderRequest): Promise<BuyHolderResponse> {
    await this.flags.assertNotMaintenance();
    const { idempotencyKey, ...payload } = request;
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'holders.buy', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const holder = config.holders.find((h) => h.id === payload.holderId);
        if (!holder) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
        if (await tx.userHolder.findFirst({ where: { userId, holderId: holder.id } })) {
          throw new AppError(ErrorCode.HOLDER_ALREADY_OWNED, HttpStatus.CONFLICT);
        }
        if (payload.payWith === 'stars')
          throw new AppError(ErrorCode.NOT_AVAILABLE, HttpStatus.CONFLICT);
        if (user.level < holder.unlockLevel)
          throw new AppError(ErrorCode.HOLDER_LOCKED, HttpStatus.FORBIDDEN);
        const price = holder.prices[payload.payWith];
        if (price === undefined) throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED);

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency: payload.payWith } },
        });
        const owned = await tx.userHolder.create({
          data: { userId, holderId: holder.id, source: 'currency' },
        });
        await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.wallet, id: wallet.id },
              delta: -BigInt(price),
              reason: LedgerReason.shop,
              ref: { type: 'user_holder', id: owned.id },
            },
          ],
          { seasonId },
        );
        return {
          holderId: holder.id,
          slotsTotal: await this.cards.totalSlots(tx, userId, config),
          wallet: {
            currency: wallet.currency,
            balance: toApiMoney(
              (await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance,
            ),
          },
        };
      },
    );
  }

  /** Daily login streak reward (TZ 8): once per UTC day; a retry with the same key replays the result. */
  async claimDaily(userId: string, idempotencyKey: string): Promise<DailyClaimResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'bonus.daily', payload: {} },
      async (tx) => {
        await lockPlayer(tx, userId);
        const now = new Date();
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const streak = await tx.dailyStreak.findUnique({ where: { userId } });
        const claim = claimDaily(
          {
            streak: streak?.streak ?? 0,
            lastClaimDay: streak?.lastClaimDate ?? null,
            forgivenessUsedDay: streak?.forgivenessUsedAt ?? null,
          },
          now,
          config,
        );
        if (!claim.ok) throw new AppError(ErrorCode.DAILY_ALREADY_CLAIMED, HttpStatus.CONFLICT);

        const state = {
          streak: claim.state.streak,
          lastClaimDate: claim.state.lastClaimDay,
          forgivenessUsedAt: claim.state.forgivenessUsedDay,
        };
        await tx.dailyStreak.upsert({
          where: { userId },
          create: { userId, ...state },
          update: state,
        });

        const reward = scaleDailyReward(
          claim.reward,
          levelForExp(user.exp + config.exp.dailyClaim, config),
          config.daily,
        );
        // EXP and the visit first, then the reward (it may add free spins, a guarantee or a chest).
        const exp = user.exp + config.exp.dailyClaim;
        const level = levelForExp(exp, config);
        const updated = await tx.user.update({
          where: { id: userId },
          data: { exp, level, lastSeenAt: now },
        });
        const credited = await grantReward(this.ledger, reward, {
          tx,
          user: updated,
          config,
          seasonId,
          reason: LedgerReason.daily,
          ref: { type: 'daily', id: `${userId}:${utcDay(now).toISOString().slice(0, 10)}` },
          buffSource: 'daily',
          moneyScaled: true,
        });
        await this.referrals.rewardIfQualified(
          tx,
          { id: userId, totalSpins: user.totalSpins, level, region: user.region },
          config,
          seasonId,
        );
        await this.quests.record(tx, updated, [{ type: 'daily_claim' }], { config, seasonId, now });
        return {
          day: claim.day,
          forgiven: claim.forgiven,
          reward,
          credited,
          exp: { gained: config.exp.dailyClaim, total: exp, level },
        };
      },
    );
  }
}
