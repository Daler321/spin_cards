import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  addHours,
  cardBalance,
  cardLuckPoints,
  cashoutFeeBp,
  collectionLevel,
  extensionHours,
  numberMultBp,
  type PatternMatch,
  rarityScore,
} from '@spincards/game-core';
import {
  cardSpinUsage,
  type CollectRequest,
  type CollectResponse,
  isUpgradeTier,
  nextTier,
  STARTER_HOLDER_ID,
  ErrorCode,
  type GameConfig,
  lifecyclePrices,
  seasonCardDesign,
  type StarsProductKind,
  trophyPrice,
  type TrophyResponse,
} from '@spincards/shared';
import { EventsService } from '../analytics/events.service.js';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import {
  type Wallet,
  type Card,
  CardStatus,
  LedgerAccountType,
  LedgerReason,
  type User,
} from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import {
  accountKey,
  type AccountRef,
  LedgerService,
  type Posting,
} from '../ledger/ledger.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { cardCashoutFeeBp, effectiveCard, toCardView } from './card-view.js';
import { payoutOf } from './money.js';
import { AchievementsService } from './achievements.service.js';
import { QuestsService } from './quests.service.js';
import { lockPlayer } from './player-lock.js';
import type {
  BatchCashoutResponse,
  CardActionResponse,
  CashoutResponse,
  HolderView,
  TrophyRemoveResponse,
  TransferRequest,
  TransferResponse,
} from '@spincards/shared';

const LIVE: CardStatus[] = [CardStatus.active, CardStatus.expired];

interface Context {
  tx: Tx;
  user: User;
  card: Card;
  config: GameConfig;
  seasonId: string;
  now: Date;
}

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
    private readonly events: EventsService,
    private readonly quests: QuestsService,
    private readonly achievements: AchievementsService,
  ) {}

  async holder(userId: string): Promise<HolderView> {
    const { config } = await this.config.active();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const rows = await this.prisma.card.findMany({
      where: { ownerId: userId, status: { in: LIVE } },
      orderBy: { issuedAt: 'desc' },
    });
    const cards = rows.map((c) => effectiveCard(c, now, config)).filter((c) => c !== null);
    const held = cards.filter((c) => c.heldAt !== null);
    const pending = cards.filter((c) => c.heldAt === null);
    const score = held.reduce((sum, c) => sum + c.rarityScore, 0);
    return {
      cards: held.map((c) => toCardView(c, config, user.level)),
      pending: pending.map((c) => toCardView(c, config, user.level)),
      slots: { used: held.length, total: await this.totalSlots(this.prisma, userId, config) },
      ownedHolders: await this.ownedHolderIds(this.prisma, userId),
      collection: { score, ...collectionLevel(score, config) },
    };
  }

  /** Keeps the dropped card in the holder if a slot is free. */
  hold(userId: string, cardId: string, key: string): Promise<CardActionResponse> {
    return this.mutate(
      userId,
      cardId,
      key,
      'card.hold',
      {},
      async ({ tx, user, card, config, seasonId, now }) => {
        if (card.heldAt !== null) return { card: toCardView(card, config, user.level) };
        const used = await tx.card.count({
          where: { ownerId: user.id, status: { in: LIVE }, heldAt: { not: null } },
        });
        if (used >= (await this.totalSlots(tx, user.id, config))) {
          throw new AppError(ErrorCode.HOLDER_FULL, HttpStatus.CONFLICT);
        }
        const updated = await tx.card.update({ where: { id: card.id }, data: { heldAt: now } });
        await this.events.track(
          [{ userId: user.id, name: 'card_held', props: { cardId: card.id, tier: card.tier } }],
          tx,
        );
        await this.quests.record(tx, user, [{ type: 'hold', count: 1 }], {
          config,
          seasonId,
          now,
        });
        // Keep the effective status (an expired-but-not-yet-swept card stays expired in the view).
        updated.status = card.status;
        updated.graceUntil = card.graceUntil;
        return { card: toCardView(updated, config, user.level) };
      },
    );
  }

  /**
   * Moves the card balance minus the fee to the wallet of its currency; the card returns to the pool
   * without an owner (TZ 4.9, 5.3). Expired cards pay the penalty fee (TZ 6).
   */
  cashout(
    userId: string,
    cardId: string,
    key: string,
    toCardId?: string,
  ): Promise<CashoutResponse> {
    return this.mutate(
      userId,
      cardId,
      key,
      'card.cashout',
      { toCardId: toCardId ?? null },
      async ({ tx, user, card, config, seasonId, now }) => {
        const feeBp = cardCashoutFeeBp(card, config, user.level);
        const payout = payoutOf(card.balance, feeBp);
        const ref = { type: 'card', id: card.id };

        // Payout target: the wallet of the card currency, or another held card the player spins with.
        let targetRef: AccountRef;
        let wallet: Wallet | null = null;
        if (toCardId) {
          const target = await tx.card.findUnique({ where: { id: toCardId } });
          if (
            !target ||
            target.id === card.id ||
            target.ownerId !== user.id ||
            target.heldAt === null ||
            target.status !== CardStatus.active ||
            target.expiresAt <= now ||
            target.currency !== card.currency
          ) {
            throw new AppError(ErrorCode.CARD_NOT_USABLE);
          }
          targetRef = { type: LedgerAccountType.card, id: target.id };
        } else {
          wallet = await tx.wallet.findUniqueOrThrow({
            where: { userId_currency: { userId: user.id, currency: card.currency } },
          });
          targetRef = { type: LedgerAccountType.wallet, id: wallet.id };
        }
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.card, id: card.id },
              delta: -card.balance,
              reason: LedgerReason.cashout,
              ref,
            },
            { account: targetRef, delta: payout, reason: LedgerReason.cashout, ref },
          ],
          { seasonId },
        );
        await tx.card.update({
          where: { id: card.id },
          data: {
            status: CardStatus.pooled,
            ownerId: null,
            heldAt: null,
            graceUntil: null,
            pooledAt: now,
          },
        });
        await tx.userSeasonStat.upsert({
          where: { userId_seasonId: { userId: user.id, seasonId } },
          create: { userId: user.id, seasonId, cashedOutMinor: payout },
          update: { cashedOutMinor: { increment: payout } },
        });
        await this.quests.record(tx, user, [{ type: 'cashout', count: 1 }], {
          config,
          seasonId,
          now,
        });
        const targetBalance = toApiMoney(balances.get(accountKey(targetRef)) ?? 0n);
        return {
          cardId: card.id,
          payout: toApiMoney(payout),
          fee: toApiMoney(card.balance - payout),
          wallet: wallet ? { currency: wallet.currency, balance: targetBalance } : null,
          toCard: toCardId ? { id: toCardId, balance: targetBalance } : null,
        };
      },
    );
  }

  /**
   * Puts a card into the album as a trophy (D-129): its balance is cashed out to the wallet with
   * the usual fee, the slot price (by rarity) is paid from that wallet, and the card stays with the
   * player forever: no balance, no expiry, never re-drops. Needs a free album slot.
   */
  toTrophy(userId: string, cardId: string, key: string): Promise<TrophyResponse> {
    return this.mutate(
      userId,
      cardId,
      key,
      'card.trophy',
      {},
      ({ tx, user, card, config, seasonId }) =>
        this.putInAlbum(
          tx,
          user,
          card,
          config,
          seasonId,
          BigInt(trophyPrice(card, card.currency, config)),
        ),
    );
  }

  /**
   * D-139: removes a trophy from the album to free its slot. The card leaves the game for good
   * (it has no balance; the slot price is not refunded) and never drops again.
   */
  async removeTrophy(userId: string, cardId: string, key: string): Promise<TrophyRemoveResponse> {
    await this.flags.assertNotMaintenance();
    return this.idempotency.run(
      { userId, key, route: 'card.trophy_remove', payload: { cardId } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const card = await tx.card.findUnique({ where: { id: cardId } });
        if (card?.ownerId !== userId || card.status !== CardStatus.trophy)
          throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
        await tx.card.update({
          where: { id: card.id },
          data: { status: CardStatus.cashed, ownerId: null },
        });
        await this.events.track(
          [{ userId, name: 'card_trophy_removed', props: { cardId: card.id, tier: card.tier } }],
          tx,
        );
        return { cardId: card.id };
      },
    );
  }

  /**
   * The album step shared by money (D-129) and Stars (D-146): needs a free slot; the card's balance
   * is cashed out to the wallet, `price` (zero for Stars) is paid from it.
   */
  private async putInAlbum(
    tx: Tx,
    user: User,
    card: Card,
    config: GameConfig,
    seasonId: string,
    price: bigint,
  ): Promise<TrophyResponse> {
    const used = await tx.card.count({
      where: { ownerId: user.id, status: CardStatus.trophy },
    });
    if (used >= config.showcase.freeSlots + user.showcaseSlots)
      throw new AppError(ErrorCode.ALBUM_FULL, HttpStatus.CONFLICT);
    const payout = payoutOf(card.balance, cardCashoutFeeBp(card, config, user.level));
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: card.currency } },
    });
    const walletRef = { type: LedgerAccountType.wallet, id: wallet.id };
    const ref = { type: 'card', id: card.id };
    const postings: Posting[] = [
      ...(card.balance > 0n
        ? [
            {
              account: { type: LedgerAccountType.card, id: card.id },
              delta: -card.balance,
              reason: LedgerReason.cashout,
              ref,
            },
            { account: walletRef, delta: payout, reason: LedgerReason.cashout, ref },
          ]
        : []),
      // Paid for with Stars: no money price.
      ...(price > 0n
        ? [{ account: walletRef, delta: -price, reason: LedgerReason.trophy, ref }]
        : []),
    ];
    const balances =
      postings.length > 0
        ? await this.ledger.post(tx, postings, { seasonId })
        : new Map([[accountKey(walletRef), wallet.balance]]);
    const season = await this.seasons.current();
    const trophy = await tx.card.update({
      where: { id: card.id },
      // D-168: the album keeps the look the card had this season.
      data: {
        status: CardStatus.trophy,
        heldAt: null,
        graceUntil: null,
        design: seasonCardDesign(season.designSetId),
      },
    });
    await this.events.track(
      [{ userId: user.id, name: 'card_trophy', props: { cardId: card.id, tier: card.tier } }],
      tx,
    );
    await this.achievements.record(
      tx,
      user,
      { trophies: used + 1 },
      { config, seasonId, seasonName: season.name },
    );
    return {
      card: toCardView(trophy, config, user.level),
      price: toApiMoney(price),
      payout: toApiMoney(payout),
      wallet: {
        currency: card.currency,
        balance: toApiMoney(balances.get(accountKey(walletRef)) ?? 0n),
      },
    };
  }

  /** D-146: whether a card product can be bought for Stars now; returns the card for its price. */
  async checkStarsCard(
    db: Tx | PrismaService,
    userId: string,
    kind: StarsProductKind,
    cardId: string,
    config: GameConfig,
    now: Date,
  ): Promise<Card> {
    const row = await db.card.findUnique({ where: { id: cardId } });
    const card =
      row && row.ownerId === userId && LIVE.includes(row.status)
        ? effectiveCard(row, now, config)
        : null;
    if (!card) throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
    if (kind === 'card_limit_reset') {
      const usage = cardSpinUsage(
        { windowStartedAt: card.spinWindowStartedAt, spinsInWindow: card.spinsInWindow },
        config.cardSpinLimit,
        now,
      );
      if (!card.heldAt || usage.used === 0)
        throw new AppError(ErrorCode.CARD_NOT_USABLE, HttpStatus.CONFLICT);
    }
    if (kind === 'card_extend' && (card.status !== CardStatus.active || card.expiresAt <= now))
      throw new AppError(ErrorCode.CARD_NOT_EXTENDABLE, HttpStatus.CONFLICT);
    if (kind === 'card_upgrade') {
      // D-171: a live card below Mythic whose number is free in the next tier of its bank.
      const up = nextTier(card.tier);
      if (
        !(await this.flags.isEnabled('craft_enabled')) ||
        !up ||
        card.status !== CardStatus.active ||
        card.expiresAt <= now ||
        (await db.card.count({ where: { number: card.number, bankId: card.bankId, tier: up } })) > 0
      )
        throw new AppError(ErrorCode.CARD_NOT_UPGRADABLE, HttpStatus.CONFLICT);
    }
    if (kind === 'trophy') {
      const [used, user] = await Promise.all([
        db.card.count({ where: { ownerId: userId, status: CardStatus.trophy } }),
        db.user.findUniqueOrThrow({ where: { id: userId }, select: { showcaseSlots: true } }),
      ]);
      if (used >= config.showcase.freeSlots + user.showcaseSlots)
        throw new AppError(ErrorCode.ALBUM_FULL, HttpStatus.CONFLICT);
    }
    return card;
  }

  /** D-146: credits a card product bought for Stars, inside the payment's transaction. */
  async applyStarsCard(
    tx: Tx,
    userId: string,
    kind: StarsProductKind,
    cardId: string,
    config: GameConfig,
    seasonId: string,
    now: Date,
  ): Promise<void> {
    const card = await this.checkStarsCard(tx, userId, kind, cardId, config, now);
    switch (kind) {
      case 'card_limit_reset':
        await tx.card.update({
          where: { id: card.id },
          data: { spinsInWindow: 0, spinWindowStartedAt: null },
        });
        return;
      case 'card_extend':
        // For Stars the one-time limit of money extensions does not apply.
        await tx.card.update({
          where: { id: card.id },
          data: {
            expiresAt: addHours(
              card.expiresAt,
              extensionHours(config.tiers[card.tier].lifespanHours, config),
            ),
            extendedCount: { increment: 1 },
          },
        });
        return;
      case 'trophy': {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        await this.putInAlbum(tx, user, card, config, seasonId, 0n);
        return;
      }
      case 'card_upgrade': {
        // D-171: same number and base limit, valued as the next tier; the difference of the
        // initial balance is added to the card.
        if (!isUpgradeTier(card.tier)) throw new AppError(ErrorCode.CARD_NOT_UPGRADABLE);
        const tier = nextTier(card.tier) ?? card.tier;
        const patterns = card.numberPatterns as unknown as PatternMatch[];
        const initial = BigInt(
          cardBalance(
            Number(card.baseLimit),
            config.tiers[tier].designMultBp,
            numberMultBp(patterns, config),
          ),
        );
        const added = initial > card.initialBalance ? initial - card.initialBalance : 0n;
        await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.card, id: card.id },
              delta: added,
              reason: LedgerReason.card_upgrade,
              ref: { type: 'card', id: card.id },
            },
          ],
          { seasonId },
        );
        await tx.card.update({
          where: { id: card.id },
          data: {
            tier,
            initialBalance: initial,
            rarityScore: rarityScore(tier, patterns, config),
            luckBonusBp: cardLuckPoints(tier, patterns, config),
          },
        });
        return;
      }
      default:
        throw new Error(`${kind} is not a card product`);
    }
  }

  /** Moves money from the wallet of the same currency onto a held, active card (no fee). */
  topup(userId: string, cardId: string, amount: number, key: string): Promise<CardActionResponse> {
    return this.mutate(
      userId,
      cardId,
      key,
      'card.topup',
      { amount },
      async ({ tx, user, card, config, seasonId, now }) => {
        assertUsable(card, now);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId: user.id, currency: card.currency } },
        });
        const ref = { type: 'card', id: card.id };
        const cardRef = { type: LedgerAccountType.card, id: card.id };
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.wallet, id: wallet.id },
              delta: -BigInt(amount),
              reason: LedgerReason.topup,
              ref,
            },
            { account: cardRef, delta: BigInt(amount), reason: LedgerReason.topup, ref },
          ],
          { seasonId },
        );
        const updated = { ...card, balance: balances.get(accountKey(cardRef)) ?? card.balance };
        return {
          card: toCardView(updated, config, user.level),
          wallets: await walletsOf(tx, user.id),
        };
      },
    );
  }

  /** Before expiry, once: pay the rarity price (D-115) from the wallet for +50% of the lifespan. */
  extend(userId: string, cardId: string, key: string): Promise<CardActionResponse> {
    return this.mutate(
      userId,
      cardId,
      key,
      'card.extend',
      {},
      async ({ tx, user, card, config, seasonId, now }) => {
        if (
          card.status !== CardStatus.active ||
          card.expiresAt <= now ||
          card.extendedCount >= config.lifecycle.maxExtends
        ) {
          throw new AppError(ErrorCode.CARD_NOT_EXTENDABLE, HttpStatus.CONFLICT);
        }
        const price = lifecyclePrices(card, card.currency, config.lifecycle).extend;
        await this.chargeWallet(tx, user.id, card, price, LedgerReason.extend, seasonId);
        const updated = await tx.card.update({
          where: { id: card.id },
          data: {
            expiresAt: addHours(
              card.expiresAt,
              extensionHours(config.tiers[card.tier].lifespanHours, config),
            ),
            extendedCount: { increment: 1 },
          },
        });
        return { card: toCardView(updated, config, user.level) };
      },
    );
  }

  /** Within the grace window: pay the restore price (D-115) from the wallet; a full lifespan again. */
  restore(userId: string, cardId: string, key: string): Promise<CardActionResponse> {
    return this.mutate(
      userId,
      cardId,
      key,
      'card.restore',
      {},
      async ({ tx, user, card, config, seasonId, now }) => {
        if (
          card.status !== CardStatus.expired ||
          (card.graceUntil !== null && card.graceUntil <= now)
        ) {
          throw new AppError(ErrorCode.CARD_NOT_RESTORABLE, HttpStatus.CONFLICT);
        }
        const price = lifecyclePrices(card, card.currency, config.lifecycle).restore;
        await this.chargeWallet(tx, user.id, card, price, LedgerReason.restore, seasonId);
        const updated = await tx.card.update({
          where: { id: card.id },
          data: {
            status: CardStatus.active,
            expiresAt: addHours(now, config.tiers[card.tier].lifespanHours),
            graceUntil: null,
          },
        });
        return { card: toCardView(updated, config, user.level) };
      },
    );
  }

  /** Lifecycle prices are paid from the wallet of the card's currency (an empty card is not free). */
  private async chargeWallet(
    tx: Tx,
    userId: string,
    card: Card,
    price: number,
    reason: LedgerReason,
    seasonId: string,
  ): Promise<void> {
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId, currency: card.currency } },
    });
    await this.ledger.post(
      tx,
      [
        {
          account: { type: LedgerAccountType.wallet, id: wallet.id },
          delta: -BigInt(price),
          reason,
          ref: { type: 'card', id: card.id },
        },
      ],
      { seasonId },
    );
  }

  /** Shared frame: maintenance check, idempotency, player lock, ownership and liveness of the card. */
  private async mutate<T extends object>(
    userId: string,
    cardId: string,
    key: string,
    route: string,
    payload: object,
    action: (ctx: Context) => Promise<T>,
  ): Promise<T> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    return this.idempotency.run(
      { userId, key, route, payload: { cardId, ...payload } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const row = await tx.card.findUnique({ where: { id: cardId } });
        const now = new Date();
        const card =
          row && row.ownerId === userId && LIVE.includes(row.status)
            ? effectiveCard(row, now, config)
            : null;
        if (!card) throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
        return action({ tx, user, card, config, seasonId, now });
      },
    );
  }

  /** Cashes out several dropped cards in one transaction (multi-spin "all to wallet/card"). */
  cashoutMany(
    userId: string,
    cardIds: string[],
    key: string,
    toCardId?: string,
  ): Promise<BatchCashoutResponse> {
    return this.batch(
      userId,
      cardIds,
      key,
      'card.cashout_many',
      { toCardId: toCardId ?? null },
      async ({ tx, user, cards, config, seasonId, now }) => {
        const target = toCardId ? await this.usableCard(tx, user.id, toCardId, now) : null;
        if (
          target &&
          (cards.some((c) => c.id === target.id) ||
            cards.some((c) => c.currency !== target.currency))
        ) {
          throw new AppError(ErrorCode.CARD_NOT_USABLE);
        }
        const currency = cards[0]?.currency ?? 'RUB';
        if (cards.some((c) => c.currency !== currency))
          throw new AppError(ErrorCode.VALIDATION_FAILED);
        const wallet = target
          ? null
          : await tx.wallet.findUniqueOrThrow({
              where: { userId_currency: { userId: user.id, currency } },
            });
        const targetRef: AccountRef = target
          ? { type: LedgerAccountType.card, id: target.id }
          : { type: LedgerAccountType.wallet, id: (wallet as Wallet).id };

        const { payout, gross, balances } = await this.cashOutCards(tx, user, cards, targetRef, {
          config,
          seasonId,
          now,
        });
        const targetBalance = toApiMoney(balances.get(accountKey(targetRef)) ?? 0n);
        return {
          cardIds: cards.map((c) => c.id),
          payout: toApiMoney(payout),
          fee: toApiMoney(gross - payout),
          wallet: wallet ? { currency, balance: targetBalance } : null,
          toCard: target ? { id: target.id, balance: targetBalance } : null,
        };
      },
    );
  }

  /**
   * Cashes cards out to one account inside the caller's transaction (batch cash-out, auto-sell
   * D-175, craft D-170): each balance minus its fee, the cards go to the pool or to `status`.
   */
  async cashOutCards(
    tx: Tx,
    user: User,
    cards: Card[],
    targetRef: AccountRef,
    ctx: { config: GameConfig; seasonId: string; now: Date },
    status: CardStatus = CardStatus.pooled,
  ): Promise<{ payout: bigint; gross: bigint; balances: Map<string, bigint> }> {
    const { config, seasonId, now } = ctx;
    const postings: Posting[] = [];
    let payout = 0n;
    let gross = 0n;
    for (const card of cards) {
      const amount = payoutOf(card.balance, cardCashoutFeeBp(card, config, user.level));
      payout += amount;
      gross += card.balance;
      const ref = { type: 'card', id: card.id };
      postings.push({
        account: { type: LedgerAccountType.card, id: card.id },
        delta: -card.balance,
        reason: LedgerReason.cashout,
        ref,
      });
      postings.push({ account: targetRef, delta: amount, reason: LedgerReason.cashout, ref });
    }
    const balances = await this.ledger.post(tx, postings, { seasonId });
    await tx.card.updateMany({
      where: { id: { in: cards.map((c) => c.id) } },
      data:
        status === CardStatus.pooled
          ? { status, ownerId: null, heldAt: null, graceUntil: null, pooledAt: now }
          : { status, heldAt: null, graceUntil: null },
    });
    await tx.userSeasonStat.upsert({
      where: { userId_seasonId: { userId: user.id, seasonId } },
      create: { userId: user.id, seasonId, cashedOutMinor: payout },
      update: { cashedOutMinor: { increment: payout } },
    });
    await this.quests.record(tx, user, [{ type: 'cashout', count: cards.length }], {
      config,
      seasonId,
      now,
    });
    return { payout, gross, balances };
  }

  /** Keeps several dropped cards at once; all or nothing when slots run out. */
  holdMany(userId: string, cardIds: string[], key: string): Promise<{ cardIds: string[] }> {
    return this.batch(
      userId,
      cardIds,
      key,
      'card.hold_many',
      {},
      async ({ tx, user, cards, config, seasonId, now }) => {
        const pending = cards.filter((c) => c.heldAt === null);
        const used = await tx.card.count({
          where: { ownerId: user.id, status: { in: LIVE }, heldAt: { not: null } },
        });
        if (used + pending.length > (await this.totalSlots(tx, user.id, config))) {
          throw new AppError(ErrorCode.HOLDER_FULL, HttpStatus.CONFLICT);
        }
        await tx.card.updateMany({
          where: { id: { in: pending.map((c) => c.id) } },
          data: { heldAt: now },
        });
        await this.events.track(
          pending.map((c) => ({
            userId: user.id,
            name: 'card_held' as const,
            props: { cardId: c.id, tier: c.tier },
          })),
          tx,
        );
        if (pending.length > 0)
          await this.quests.record(tx, user, [{ type: 'hold', count: pending.length }], {
            config,
            seasonId,
            now,
          });
        return { cardIds: cards.map((c) => c.id) };
      },
    );
  }

  /**
   * Moves money between the player's wallet and held cards of the same currency (D-088):
   * wallet->card free, card->card cardToCardFeeBp, card->wallet the level-based cash-out fee.
   * The fee is taken from the amount; source cards must be held, active and not expired.
   */
  async transfer(userId: string, request: TransferRequest): Promise<TransferResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'transfer', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const now = new Date();
        const { from, to } = payload;
        if (from.type === 'wallet' && to.type === 'wallet')
          throw new AppError(ErrorCode.VALIDATION_FAILED);
        if (from.type === 'card' && to.type === 'card' && from.cardId === to.cardId) {
          throw new AppError(ErrorCode.VALIDATION_FAILED);
        }
        const fromCard =
          from.type === 'card' ? await this.usableCard(tx, userId, from.cardId, now) : null;
        const toCard =
          to.type === 'card' ? await this.usableCard(tx, userId, to.cardId, now) : null;
        const currency = (fromCard ?? toCard)?.currency ?? 'RUB';
        if (fromCard && toCard && fromCard.currency !== toCard.currency)
          throw new AppError(ErrorCode.CARD_NOT_USABLE);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency } },
        });

        const feeBp = !fromCard
          ? 0
          : toCard
            ? config.transfer.cardToCardFeeBp
            : cashoutFeeBp(user.level, config);
        const amount = BigInt(payload.amount);
        const fee = (amount * BigInt(feeBp) + 9999n) / 10_000n;
        const received = amount - fee;
        if (received <= 0n) throw new AppError(ErrorCode.VALIDATION_FAILED);

        const ref = { type: 'transfer', id: randomUUID() };
        const sourceRef: AccountRef = fromCard
          ? { type: LedgerAccountType.card, id: fromCard.id }
          : { type: LedgerAccountType.wallet, id: wallet.id };
        const targetRef: AccountRef = toCard
          ? { type: LedgerAccountType.card, id: toCard.id }
          : { type: LedgerAccountType.wallet, id: wallet.id };
        const balances = await this.ledger.post(
          tx,
          [
            { account: sourceRef, delta: -amount, reason: LedgerReason.transfer, ref },
            { account: targetRef, delta: received, reason: LedgerReason.transfer, ref },
          ],
          { seasonId },
        );
        const walletKey = accountKey({ type: LedgerAccountType.wallet, id: wallet.id });
        return {
          amount: toApiMoney(amount),
          fee: toApiMoney(fee),
          received: toApiMoney(received),
          wallet: { currency, balance: toApiMoney(balances.get(walletKey) ?? wallet.balance) },
          cards: [fromCard, toCard]
            .filter((c): c is Card => c !== null)
            .map((c) => ({
              id: c.id,
              balance: toApiMoney(
                balances.get(accountKey({ type: LedgerAccountType.card, id: c.id })) ?? c.balance,
              ),
            })),
        };
      },
    );
  }

  /**
   * D-174: every other held, active card of the currency sends its whole balance to one place:
   * a card (cardToCardFeeBp) or the wallet (the level cash-out fee), each fee rounded up.
   */
  async collect(userId: string, request: CollectRequest): Promise<CollectResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'transfer.collect', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const now = new Date();
        const { currency, to } = payload;
        const target =
          to.type === 'card' ? await this.usableCard(tx, userId, to.cardId, now) : null;
        if (target && target.currency !== currency) throw new AppError(ErrorCode.CARD_NOT_USABLE);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency } },
        });
        const sources = await tx.card.findMany({
          where: {
            ownerId: userId,
            currency,
            status: CardStatus.active,
            heldAt: { not: null },
            expiresAt: { gt: now },
            balance: { gt: 0n },
            ...(target && { id: { not: target.id } }),
          },
        });
        if (sources.length === 0)
          throw new AppError(ErrorCode.NOTHING_TO_COLLECT, HttpStatus.CONFLICT);
        const feeBp = target ? config.transfer.cardToCardFeeBp : cashoutFeeBp(user.level, config);
        const targetRef: AccountRef = target
          ? { type: LedgerAccountType.card, id: target.id }
          : { type: LedgerAccountType.wallet, id: wallet.id };
        const ref = { type: 'transfer', id: randomUUID() };
        const postings: Posting[] = [];
        let amount = 0n;
        let fee = 0n;
        for (const card of sources) {
          const cardFee = (card.balance * BigInt(feeBp) + 9999n) / 10_000n;
          amount += card.balance;
          fee += cardFee;
          postings.push(
            {
              account: { type: LedgerAccountType.card, id: card.id },
              delta: -card.balance,
              reason: LedgerReason.transfer,
              ref,
            },
            {
              account: targetRef,
              delta: card.balance - cardFee,
              reason: LedgerReason.transfer,
              ref,
            },
          );
        }
        const balances = await this.ledger.post(tx, postings, { seasonId });
        const walletKey = accountKey({ type: LedgerAccountType.wallet, id: wallet.id });
        return {
          cards: sources.length,
          amount: toApiMoney(amount),
          fee: toApiMoney(fee),
          received: toApiMoney(amount - fee),
          wallet: { currency, balance: toApiMoney(balances.get(walletKey) ?? wallet.balance) },
        };
      },
    );
  }

  /** A held, active, not expired card of the player (payment, payout or transfer endpoint). */
  async usableCard(tx: Tx, userId: string, cardId: string, now: Date): Promise<Card> {
    const card = await tx.card.findUnique({ where: { id: cardId } });
    if (
      !card ||
      card.ownerId !== userId ||
      card.heldAt === null ||
      card.status !== CardStatus.active ||
      card.expiresAt <= now
    ) {
      throw new AppError(ErrorCode.CARD_NOT_USABLE);
    }
    return card;
  }

  /** Frame for batch actions over the player's live cards (1..4 distinct ids). */
  private async batch<T extends object>(
    userId: string,
    cardIds: string[],
    key: string,
    route: string,
    payload: object,
    action: (ctx: Omit<Context, 'card'> & { cards: Card[] }) => Promise<T>,
  ): Promise<T> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const ids = [...new Set(cardIds)].sort();
    return this.idempotency.run(
      { userId, key, route, payload: { cardIds: ids, ...payload } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const now = new Date();
        const rows = await tx.card.findMany({ where: { id: { in: ids } } });
        const cards = rows
          .filter((row) => row.ownerId === userId && LIVE.includes(row.status))
          .map((row) => effectiveCard(row, now, config))
          .filter((c): c is Card => c !== null);
        if (cards.length !== ids.length)
          throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
        return action({ tx, user, cards, config, seasonId, now });
      },
    );
  }

  async totalSlots(db: Tx | PrismaService, userId: string, config: GameConfig): Promise<number> {
    const owned = await this.ownedHolderIds(db, userId);
    return owned.reduce(
      (sum, id) => sum + (config.holders.find((c) => c.id === id)?.slots ?? 0),
      0,
    );
  }

  /** Bought holders plus the free starter one, which every player always has (D-150). */
  async ownedHolderIds(db: Tx | PrismaService, userId: string): Promise<string[]> {
    const rows = await db.userHolder.findMany({ where: { userId }, select: { holderId: true } });
    return [...new Set([STARTER_HOLDER_ID, ...rows.map((h) => h.holderId)])];
  }
}

function assertUsable(card: Card, now: Date): void {
  if (card.status !== CardStatus.active || card.expiresAt <= now) {
    throw new AppError(ErrorCode.CARD_EXPIRED, HttpStatus.CONFLICT);
  }
  if (card.heldAt === null) throw new AppError(ErrorCode.CARD_NOT_USABLE);
}

async function walletsOf(tx: Tx, userId: string) {
  const wallets = await tx.wallet.findMany({ where: { userId }, orderBy: { currency: 'asc' } });
  return wallets.map((w) => ({ currency: w.currency, balance: toApiMoney(w.balance) }));
}
