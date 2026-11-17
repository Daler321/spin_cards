import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AlbumIncomeClaimResponse,
  ErrorCode,
  type NickBonusClaimResponse,
} from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { CardStatus, LedgerAccountType, LedgerReason } from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, LedgerService } from '../ledger/ledger.service.js';
import { grantReward } from './grant-reward.js';
import { albumIncomeAmount, nextClaimAt } from './income.js';
import { lockPlayer } from './player-lock.js';

const HOUR = 3_600_000;

/** D-172 album income and D-173 the name tag bonus: claims, each once per interval. */
@Injectable()
export class IncomeService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
  ) {}

  async claimAlbumIncome(userId: string, key: string): Promise<AlbumIncomeClaimResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const income = config.albumIncome;
    if (!income || !(await this.flags.isEnabled('album_income_enabled')))
      throw new AppError(ErrorCode.NOT_AVAILABLE, HttpStatus.CONFLICT);
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key, route: 'bonus.album_income', payload: {} },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const now = new Date();
        const currency = config.regions[user.region].currency;
        const trophies = await tx.card.findMany({
          where: { ownerId: userId, status: CardStatus.trophy },
          select: { tier: true },
        });
        const amount = albumIncomeAmount(trophies, income, currency);
        if (amount === 0 || nextClaimAt(user.albumIncomeAt, income.intervalHours, now))
          throw new AppError(ErrorCode.ALBUM_INCOME_NOT_READY, HttpStatus.CONFLICT);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency } },
        });
        const walletRef = { type: LedgerAccountType.wallet, id: wallet.id };
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: walletRef,
              delta: BigInt(amount),
              reason: LedgerReason.album_income,
              ref: { type: 'album_income', id: `${userId}:${now.toISOString()}` },
            },
          ],
          { seasonId },
        );
        await tx.user.update({ where: { id: userId }, data: { albumIncomeAt: now } });
        return {
          amount,
          currency,
          wallet: { currency, balance: toApiMoney(balances.get(accountKey(walletRef)) ?? 0n) },
          availableAt: new Date(now.getTime() + income.intervalHours * HOUR).toISOString(),
        };
      },
    );
  }

  async claimNickBonus(userId: string, key: string): Promise<NickBonusClaimResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const bonus = config.nickBonus;
    if (!bonus || !(await this.flags.isEnabled('nick_bonus_enabled')))
      throw new AppError(ErrorCode.NOT_AVAILABLE, HttpStatus.CONFLICT);
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run({ userId, key, route: 'bonus.nick', payload: {} }, async (tx) => {
      await lockPlayer(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const now = new Date();
      if (!user.nickHasTag) throw new AppError(ErrorCode.NICK_TAG_MISSING, HttpStatus.CONFLICT);
      if (nextClaimAt(user.nickBonusAt, bonus.claimHours, now))
        throw new AppError(ErrorCode.NICK_BONUS_NOT_READY, HttpStatus.CONFLICT);
      await tx.user.update({ where: { id: userId }, data: { nickBonusAt: now } });
      const credited = await grantReward(this.ledger, bonus.reward, {
        tx,
        user,
        config,
        seasonId,
        reason: LedgerReason.nick_bonus,
        ref: { type: 'nick_bonus', id: `${userId}:${now.toISOString()}` },
        buffSource: 'nick_bonus',
        moneyScaled: true,
      });
      return {
        credited,
        freeSpins: bonus.reward.freeSpins ?? 0,
        availableAt: new Date(now.getTime() + bonus.claimHours * HOUR).toISOString(),
      };
    });
  }
}
