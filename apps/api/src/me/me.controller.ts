import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  accrueFreeSpins,
  cashoutFeeBp,
  isWheelAvailable,
  nextFreeSpinAt,
  utcDay,
  wheelAvailableAt,
} from '@spincards/game-core';
import { chestView } from '../game/bonus.service.js';
import { type GameConfig, REGIONS } from '@spincards/shared';
import { z } from 'zod';
import { SkipSubscription } from '../subscription/subscription.guard.js';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { toApiMoney } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { FlagsService } from '../game-config/flags.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { nextClaimAt } from '../game/income.js';
import { activeBuffsWhere, buffView } from '../game/buffs.js';
import { QuestsService } from '../game/quests.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { CardStatus, type User, type Wallet } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import type { MeResponse } from '@spincards/shared';

const RegionSchema = z.object({ region: z.enum(REGIONS) });

@Controller('v1/me')
@SkipSubscription()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly quests: QuestsService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
  ) {}

  @Get()
  async me(@CurrentUser() current: RequestUser): Promise<MeResponse> {
    // D-124: opening the game counts as a visit for season quests (once per Moscow day).
    await this.quests.visit(current.id).catch(() => undefined);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
      include: { wallets: { orderBy: { currency: 'asc' } } },
    });
    return this.toMe(user, (await this.config.active()).config);
  }

  @Post('region')
  @HttpCode(HttpStatus.OK)
  @RateLimit('mutation')
  async region(
    @CurrentUser() current: RequestUser,
    @Body(new ZodPipe(RegionSchema)) body: z.infer<typeof RegionSchema>,
  ): Promise<MeResponse> {
    const user = await this.prisma.user.update({
      where: { id: current.id },
      data: { region: body.region },
      include: { wallets: { orderBy: { currency: 'asc' } } },
    });
    return this.toMe(user, (await this.config.active()).config);
  }

  private async toMe(user: User & { wallets: Wallet[] }, config: GameConfig): Promise<MeResponse> {
    const now = new Date();
    const [counters, buffs, pending, daily, trophies, albumOn, nickOn] = await Promise.all([
      this.prisma.userCounter.findMany({ where: { userId: user.id } }),
      this.prisma.userBuff.findMany({
        where: activeBuffsWhere(user.id, now),
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.card.findFirst({
        where: {
          ownerId: user.id,
          heldAt: null,
          status: { in: [CardStatus.active, CardStatus.expired] },
        },
        select: { id: true },
      }),
      this.prisma.dailyStreak.findUnique({ where: { userId: user.id } }),
      this.prisma.card.count({ where: { ownerId: user.id, status: CardStatus.trophy } }),
      this.flags.isEnabled('album_income_enabled'),
      this.flags.isEnabled('nick_bonus_enabled'),
    ]);
    const income = albumOn ? config.albumIncome : undefined;
    const nick = nickOn ? config.nickBonus : undefined;
    const free = accrueFreeSpins(
      { available: user.freeSpinsAvailable, anchorAt: user.freeSpinsAnchorAt },
      now,
      config,
    );
    const season = await this.seasons.current();
    return {
      ...profileOf(user, config),
      season: { name: season.name, endsAt: season.endsAt?.toISOString() ?? null },
      game: {
        freeSpins: {
          available: free.available,
          nextAt: nextFreeSpinAt(free, config)?.toISOString() ?? null,
        },
        luckMeters: config.packs
          .filter((p) => p.enabled)
          .map((p) => ({
            packId: p.id,
            value: counters.find((c) => c.packId === p.id)?.luckMeter ?? 0,
            max: config.luck.meterMax,
          })),
        buffs: buffs.map(buffView),
        guaranteedFloor: user.guaranteedFloor,
        pendingCardId: pending?.id ?? null,
        daily: {
          streak: daily?.streak ?? 0,
          claimedToday: daily?.lastClaimDate?.getTime() === utcDay(now).getTime(),
        },
        totalSpins: user.totalSpins,
        milestone: {
          value: user.totalSpins % config.luck.milestone.everySpins,
          max: config.luck.milestone.everySpins,
        },
        returnLuckyPending: user.returnLuckyPending,
        questsReady: await this.quests.readyCount(user.id, now),
        chest: chestView(user, config),
        wheel: {
          availableAt: isWheelAvailable(user.wheelSpunAt, now, config)
            ? null
            : (wheelAvailableAt(user.wheelSpunAt, config)?.toISOString() ?? null),
        },
        cashoutFeeBp: cashoutFeeBp(user.level, config),
        albumIncome: income
          ? {
              availableAt:
                nextClaimAt(user.albumIncomeAt, income.intervalHours, now)?.toISOString() ?? null,
              trophies,
            }
          : null,
        nickBonus: nick
          ? {
              tag: nick.tag,
              hasTag: user.nickHasTag,
              checkedAt: user.nickCheckedAt?.toISOString() ?? null,
              availableAt:
                nextClaimAt(user.nickBonusAt, nick.claimHours, now)?.toISOString() ?? null,
            }
          : null,
      },
    };
  }
}

function profileOf(
  user: User & { wallets: Wallet[] },
  config: GameConfig,
): Omit<MeResponse, 'game' | 'season'> {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    photoUrl: user.photoUrl,
    region: user.region,
    level: user.level,
    exp: user.exp,
    nextLevelExp: config.levels.find((l) => l.level === user.level + 1)?.exp ?? null,
    referralCode: user.referralCode,
    wallets: user.wallets.map((w) => ({ currency: w.currency, balance: toApiMoney(w.balance) })),
    settings: {
      notificationsEnabled: user.notificationsEnabled,
      hideFromLeaderboard: user.hideFromLeaderboard,
      autoCashoutTiers: user.autoCashoutTiers,
    },
    createdAt: user.createdAt.toISOString(),
  };
}
