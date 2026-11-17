import { Injectable } from '@nestjs/common';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hasNickTag } from './income.js';

/** Players seen within this many days are re-checked; others wait for their next sign-in. */
const ACTIVE_DAYS = 7;
/** Per run, and the pause between Bot API calls (well below Telegram's limits). */
const BATCH = 300;
const PAUSE_MS = 40;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * D-173 (worker): re-reads the Telegram name of active players every checkHours via getChat, so a
 * tag removed after sign-in stops the bonus. Sign-in itself updates the check too.
 */
@Injectable()
export class NickCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly flags: FlagsService,
    private readonly telegram: TelegramApiService,
  ) {}

  async run(): Promise<{ checked: number }> {
    const { config } = await this.config.active();
    const bonus = config.nickBonus;
    if (!bonus || !(await this.flags.isEnabled('nick_bonus_enabled'))) return { checked: 0 };
    const now = Date.now();
    const users = await this.prisma.user.findMany({
      where: {
        isBanned: false,
        botBlockedAt: null,
        lastSeenAt: { gte: new Date(now - ACTIVE_DAYS * DAY) },
        OR: [
          { nickCheckedAt: null },
          { nickCheckedAt: { lt: new Date(now - bonus.checkHours * HOUR) } },
        ],
      },
      select: { id: true, telegramId: true },
      orderBy: { nickCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: BATCH,
    });
    let checked = 0;
    for (const user of users) {
      const name = await this.telegram.getChatName(Number(user.telegramId)).catch(() => null);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          nickCheckedAt: new Date(),
          // Telegram unreachable for this chat: the last known state stays.
          ...(name && { nickHasTag: hasNickTag(name.firstName, name.lastName, bonus) }),
        },
      });
      checked++;
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
    return { checked };
  }
}
