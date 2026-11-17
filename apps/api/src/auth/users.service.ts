import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isReturningPlayer } from '@spincards/game-core';
import { type Currency, type GameConfig, STARTER_HOLDER_ID } from '@spincards/shared';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason, type User } from '../generated/prisma/client.js';
import { EventsService } from '../analytics/events.service.js';
import { hasNickTag } from '../game/income.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service.js';
import type { TelegramUser } from './telegram-init-data.js';

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_LENGTH = 8;
const REFERRAL_PARAM = /^ref_([A-Z2-9]{8})$/;
const MAX_CREATE_ATTEMPTS = 3;

export interface PlayerProfile {
  telegramId: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  /** Absent when the bot signs the player in (it has no photo): the stored one is kept. */
  photoUrl?: string | null;
}

export function profileFromTelegram(user: TelegramUser): PlayerProfile {
  return {
    telegramId: BigInt(user.id),
    firstName: user.first_name,
    lastName: user.last_name ?? null,
    username: user.username ?? null,
    languageCode: user.language_code ?? null,
    photoUrl: user.photo_url ?? null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly events: EventsService,
  ) {}

  /**
   * /start in the bot (TZ 14): the same sign-up as the Mini App (referral payload included), and the
   * bot counts as unblocked again.
   */
  async startFromBot(
    profile: PlayerProfile,
    payload: string | null,
  ): Promise<{ user: User; isNew: boolean }> {
    const existed = await this.prisma.user.findUnique({
      where: { telegramId: profile.telegramId },
      select: { id: true },
    });
    const user = await this.signIn(profile, payload);
    const unblocked = user.botBlockedAt
      ? await this.prisma.user.update({ where: { id: user.id }, data: { botBlockedAt: null } })
      : user;
    return { user: unblocked, isNew: !existed };
  }

  /** Finds or creates the player behind a verified Telegram identity. */
  async signIn(profile: PlayerProfile, startParam: string | null): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: profile.telegramId },
    });
    if (existing) return this.touch(existing, profile);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.create(profile, startParam);
      } catch (error) {
        // A parallel first login created the user, or the referral code collided: retry.
        if (!isUniqueViolation(error) || attempt >= MAX_CREATE_ATTEMPTS) throw error;
        const created = await this.prisma.user.findUnique({
          where: { telegramId: profile.telegramId },
        });
        if (created) return this.touch(created, profile);
      }
    }
  }

  /** Refreshes the profile and flags a return after a long pause (lucky next free spin). */
  private async touch(user: User, profile: PlayerProfile): Promise<User> {
    const { config } = await this.config.active();
    const now = new Date();
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...profile,
        lastSeenAt: now,
        ...nickCheck(profile, config, now),
        ...(isReturningPlayer(user.lastSeenAt, now, config) && { returnLuckyPending: true }),
      },
    });
  }

  private async create(profile: PlayerProfile, startParam: string | null): Promise<User> {
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const referrerCode = REFERRAL_PARAM.exec(startParam ?? '')?.[1];

    return this.prisma.transaction(async (tx) => {
      const referrer = referrerCode
        ? await tx.user.findUnique({ where: { referralCode: referrerCode }, select: { id: true } })
        : null;
      const user = await tx.user.create({
        data: {
          ...profile,
          ...nickCheck(profile, config, new Date()),
          referralCode: newReferralCode(),
          referrerId: referrer?.id ?? null,
          freeSpinsAvailable: config.freeSpins.maxStored,
          // D-132: the new player's money belongs to the running season (no reset at its end yet).
          moneySeasonId: seasonId,
        },
      });

      const currencies = await tx.currency.findMany({ where: { isActive: true } });
      const wallets = await Promise.all(
        currencies.map((c) => tx.wallet.create({ data: { userId: user.id, currency: c.code } })),
      );
      await this.ledger.post(
        tx,
        wallets.map((wallet) => ({
          account: { type: LedgerAccountType.wallet, id: wallet.id },
          delta: BigInt(config.startingBalance[wallet.currency as Currency] ?? 0),
          reason: LedgerReason.signup_bonus,
          ref: { type: 'user', id: user.id },
        })),
        { seasonId },
      );

      await tx.userHolder.create({
        data: { userId: user.id, holderId: STARTER_HOLDER_ID, source: 'default' },
      });
      if (referrer) {
        await tx.referral.create({ data: { referrerId: referrer.id, referredId: user.id } });
      }
      await this.events.track(
        [{ userId: user.id, name: 'signup', props: { referred: referrer !== null } }],
        tx,
      );
      return user;
    });
  }
}

function newReferralCode(): string {
  return Array.from({ length: REFERRAL_LENGTH }, () =>
    REFERRAL_ALPHABET.charAt(randomInt(REFERRAL_ALPHABET.length)),
  ).join('');
}

/** D-173: sign-in brings the fresh name, so the tag is checked right away. */
function nickCheck(profile: PlayerProfile, config: GameConfig, now: Date) {
  const nick = config.nickBonus;
  return nick
    ? { nickCheckedAt: now, nickHasTag: hasNickTag(profile.firstName, profile.lastName, nick) }
    : {};
}
