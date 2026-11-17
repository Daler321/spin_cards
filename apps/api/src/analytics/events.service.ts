import { Injectable } from '@nestjs/common';
import { SeasonService } from '../game-config/season.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

/**
 * Analytics events (TZ 12, `events`). Only signals no other table keeps: sign-ups, app opens,
 * each spin's outcome, cards kept, bot starts and blocks. Spends, payouts, conversions, payments
 * and notifications are counted from their own tables (D-097). Written in the caller's
 * transaction, so a rolled-back action leaves no event.
 */
export type EventName =
  | 'signup'
  | 'app_open'
  | 'spin'
  | 'card_held'
  | 'card_trophy'
  | 'card_trophy_removed'
  | 'bot_start'
  | 'bot_blocked'
  | 'bot_unblocked';

export interface TrackedEvent {
  userId: string | null;
  name: EventName;
  props?: Prisma.InputJsonValue;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonService,
  ) {}

  async track(events: TrackedEvent[], tx: Tx = this.prisma): Promise<void> {
    if (events.length === 0) return;
    const seasonId = await this.seasons.currentSeasonId();
    await tx.event.createMany({
      data: events.map((e) => ({
        userId: e.userId,
        seasonId,
        name: e.name,
        props: e.props ?? {},
      })),
    });
  }
}
