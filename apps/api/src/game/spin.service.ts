import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  accrueFreeSpins,
  addHours,
  type CardPool,
  levelForExp,
  nextFreeSpinAt,
  type PackCounters,
  type PlayerCounters,
  type PooledCard,
  resolveSpin,
  type SpinPayment,
  type UniquenessChecker,
} from '@spincards/game-core';
import {
  chargeCardSpins,
  type Currency,
  ErrorCode,
  type GameConfig,
  MAX_SPINS_PER_REQUEST,
  type PackConfig,
  type Region,
  type SpinItem,
  type SpinRequest,
  type SpinResponse,
  type Tier,
} from '@spincards/shared';
import { EventsService, type TrackedEvent } from '../analytics/events.service.js';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import {
  type Card,
  CardStatus,
  LedgerAccountType,
  LedgerReason,
  type Prisma,
  SpinPaymentSource,
  type User,
  type UserBuff,
} from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, type AccountRef, LedgerService } from '../ledger/ledger.service.js';
import { isUniqueViolation, PrismaService, type Tx } from '../prisma/prisma.service.js';
import { activeBuffsWhere, toLuckBuff } from './buffs.js';
import { cardCashoutFeeBp, liveLuckPoints, toCardView } from './card-view.js';
import { CardsService } from './cards.service.js';
import { payoutOf } from './money.js';
import { cryptoRng } from './crypto-rng.js';
import { lockPlayer } from './player-lock.js';
import { AchievementsService } from './achievements.service.js';
import { QuestsService } from './quests.service.js';
import { netWorthRub } from './season-score.js';
import { ReferralService } from './referral.service.js';

interface SpinContext {
  versionId: number;
  config: GameConfig;
  seasonId: string;
  showNearMiss: boolean;
}

interface Charge {
  source: SpinPaymentSource;
  payment: SpinPayment;
  cardRef: AccountRef | null;
  cardBalance: bigint | null;
  freeSpins: { available: number; anchorAt: Date };
}

/** A concurrent spin may generate the same number; the partial unique index catches it. */
const MAX_NUMBER_RACE_RETRIES = 3;

@Injectable()
export class SpinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
    private readonly referrals: ReferralService,
    private readonly events: EventsService,
    private readonly quests: QuestsService,
    private readonly achievements: AchievementsService,
    private readonly cards: CardsService,
  ) {}

  async spin(userId: string, request: SpinRequest): Promise<SpinResponse> {
    await this.flags.assertNotMaintenance();
    // Everything outside the transaction is loaded first: a query on the shared pool from inside a
    // transaction can starve the pool under load.
    const player = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { experimentGroup: true },
    });
    const context: SpinContext = {
      ...(await this.config.forGroup(player?.experimentGroup ?? null)),
      seasonId: await this.seasons.currentSeasonId(),
      showNearMiss: await this.flags.isEnabled('near_miss_ux'),
    };
    const { idempotencyKey, ...payload } = request;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.idempotency.run(
          { userId, key: idempotencyKey, route: 'spin', payload },
          (tx) => this.execute(tx, userId, payload, context),
        );
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= MAX_NUMBER_RACE_RETRIES) throw error;
      }
    }
  }

  /**
   * Pays for `count` spins at once, then resolves them one after another: counters, buffs and
   * guarantees advance between them exactly as for separate spins (TZ 5.6).
   */
  private async execute(
    tx: Tx,
    userId: string,
    request: Omit<SpinRequest, 'idempotencyKey'>,
    { versionId, config, seasonId, showNearMiss }: SpinContext,
  ): Promise<SpinResponse> {
    const now = new Date();
    const count = Math.min(MAX_SPINS_PER_REQUEST, Math.max(1, request.count ?? 1));
    await lockPlayer(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

    const pack = config.packs.find((p) => p.id === request.packId);
    if (pack && (await this.flags.isPackPaused(pack.id)))
      throw new AppError(ErrorCode.PACK_NOT_AVAILABLE);
    if (!pack?.enabled) throw new AppError(ErrorCode.PACK_NOT_AVAILABLE);
    if (user.level < pack.unlockLevel) {
      throw new AppError(ErrorCode.PACK_LOCKED, HttpStatus.FORBIDDEN);
    }
    const region: Region = user.region;
    const currency = config.regions[region].currency;
    const price = pack.free ? 0 : pack.prices[currency];
    if (price === undefined) throw new AppError(ErrorCode.PACK_NOT_AVAILABLE);

    const pending = await tx.card.findFirst({
      where: {
        ownerId: userId,
        heldAt: null,
        status: { in: [CardStatus.active, CardStatus.expired] },
      },
      select: { id: true },
    });
    if (pending) throw new AppError(ErrorCode.CARD_DECISION_PENDING, HttpStatus.CONFLICT);

    // D-116: hidden starter luck looks at the balance the player had before paying for the batch.
    const totalBalance = await this.totalBalance(tx, userId, currency);

    // Step 1: pay for all spins at once (free spin credits, wallet or a card from the holder).
    const batchId = randomUUID();
    const charge = await this.charge(tx, {
      user,
      pack,
      price,
      count,
      currency,
      request,
      batchId,
      seasonId,
      now,
      config,
    });

    // Steps 2-7 per spin: game-core decides everything; ports reach the database in this transaction.
    const counters = await tx.userCounter.upsert({
      where: { userId_packId: { userId, packId: pack.id } },
      create: { userId, packId: pack.id },
      update: {},
    });
    // Old shop buffs belong to one pack; bonuses and Stars multipliers (no pack) work everywhere.
    const buffRows = await tx.userBuff.findMany({
      where: activeBuffsWhere(userId, new Date(), pack.id),
      orderBy: { createdAt: 'asc' },
    });
    let player: PlayerCounters = {
      totalSpins: user.totalSpins,
      returnLuckyPending: user.returnLuckyPending,
      buffs: buffRows.map(toLuckBuff),
    };
    let packCounters: PackCounters = {
      luckMeter: counters.luckMeter,
      sinceFloor: {
        rare: counters.sinceRare,
        epic: counters.sinceEpic,
        legendary: counters.sinceLegendary,
      },
      badStreak: counters.badStreak,
    };
    let guaranteedFloor: Tier | null = user.guaranteedFloor;
    let expGained = 0;
    let bestRarity = 0;
    const items: SpinItem[] = [];
    const issued: Card[] = [];
    const spinEvents: TrackedEvent[] = [];

    for (let i = 0; i < count; i++) {
      const spinId = randomUUID();
      const result = await resolveSpin(
        {
          config,
          packId: pack.id,
          region,
          payment: charge.payment,
          player,
          pack: packCounters,
          guaranteedFloor,
          playerLevel: user.level,
          totalBalance,
        },
        { rng: cryptoRng, uniqueness: uniquenessIn(tx), pool: poolIn(tx) },
      );
      player = result.player;
      packCounters = result.pack;
      guaranteedFloor = null;

      const card = await this.issueCard(tx, result.card, { userId, seasonId, now, spinId });
      issued.push(card);
      await tx.spin.create({
        data: {
          id: spinId,
          userId,
          seasonId,
          packId: pack.id,
          paymentSource: charge.source,
          paymentCardId: charge.cardRef?.id ?? null,
          price: BigInt(price),
          currency,
          configVersionId: versionId,
          rolledParams: {
            ...result.rolled,
            guaranteeApplied: result.guaranteeApplied,
            newbieStep: result.newbieStep,
            source: result.card.source,
            baseLimit: result.card.baseLimit,
            numberMultBp: result.card.numberMultBp,
            batchId,
            batchIndex: i,
          },
          cardId: card.id,
          lucky: result.lucky,
          pityApplied: result.pityApplied,
          nearMiss: (result.nearMiss ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      spinEvents.push({
        userId,
        name: 'spin',
        props: {
          spinId,
          packId: pack.id,
          paymentSource: charge.source,
          price,
          currency,
          tier: result.card.tier,
          rarityScore: result.card.rarityScore,
          issued: Number(card.initialBalance),
          patterns: result.card.patterns.map((p) => p.id),
          nearMiss: result.nearMiss?.patternId ?? null,
          source: result.card.source,
        },
      });
      expGained += pack.exp + config.exp.tierBonus[result.card.tier];
      bestRarity = Math.max(bestRarity, result.card.rarityScore);
      items.push({
        spinId,
        card: toCardView(card, config, user.level),
        lucky: result.lucky,
        pityApplied: result.pityApplied,
        guaranteeApplied: result.guaranteeApplied,
        nearMiss: showNearMiss ? result.nearMiss : null,
        autoCashedOut: null,
      });
    }

    // D-175/D-178: dropped cards of the tiers the player chose are cashed out at once: onto the card
    // that paid for the spin, or to the wallet when the wallet (or a free spin) paid.
    const auto = issued.filter((card) => user.autoCashoutTiers.includes(card.tier));
    if (auto.length > 0) {
      const target: AccountRef = charge.cardRef ?? {
        type: LedgerAccountType.wallet,
        id: (
          await tx.wallet.findUniqueOrThrow({ where: { userId_currency: { userId, currency } } })
        ).id,
      };
      const { balances } = await this.cards.cashOutCards(tx, user, auto, target, {
        config,
        seasonId,
        now,
      });
      if (charge.cardRef) charge.cardBalance = balances.get(accountKey(charge.cardRef)) ?? null;
      for (const card of auto) {
        const item = items.find((i) => i.card.id === card.id);
        if (item)
          item.autoCashedOut = {
            payout: toApiMoney(payoutOf(card.balance, cardCashoutFeeBp(card, config, user.level))),
            toCardId: charge.cardRef?.id ?? null,
          };
      }
    }

    await tx.userCounter.update({
      where: { id: counters.id },
      data: {
        luckMeter: packCounters.luckMeter,
        sinceRare: packCounters.sinceFloor.rare,
        sinceEpic: packCounters.sinceFloor.epic,
        sinceLegendary: packCounters.sinceFloor.legendary,
        badStreak: packCounters.badStreak,
      },
    });
    await consumeBuffs(tx, buffRows, count);
    await this.events.track(spinEvents, tx);
    // D-124: quests count the spins, the payment and every dropped card.
    await this.quests.record(
      tx,
      user,
      [
        { type: 'spin', count, paidWithCard: charge.source === SpinPaymentSource.card },
        ...items.map((item) => ({
          type: 'card' as const,
          tier: item.card.tier,
          bankId: item.card.bankId,
          patterned: item.card.patterns.length > 0,
        })),
      ],
      { config, seasonId, now },
    );

    const exp = user.exp + expGained;
    const level = levelForExp(exp, config);
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        exp,
        level,
        totalSpins: player.totalSpins,
        returnLuckyPending: player.returnLuckyPending,
        guaranteedFloor: null,
        freeSpinsAvailable: charge.freeSpins.available,
        freeSpinsAnchorAt: charge.freeSpins.anchorAt,
      },
    });
    await this.referrals.rewardIfQualified(
      tx,
      { id: userId, totalSpins: player.totalSpins, level, region },
      config,
      seasonId,
    );
    // D-126: the permanent album remembers every first bank+tier pair and every first pattern.
    const album = items.flatMap((item) => [
      { key: `bank:${item.card.bankId}:${item.card.tier}`, number: item.card.number },
      ...item.card.patterns.map((p) => ({ key: `pattern:${p.id}`, number: item.card.number })),
    ]);
    await tx.$executeRaw`
      INSERT INTO album_entries (id, user_id, key, card_number, season_id)
      SELECT gen_random_uuid(), ${userId}::uuid, a.key, a.number, ${seasonId}::uuid
      FROM unnest(${album.map((a) => a.key)}::text[], ${album.map((a) => a.number)}::text[])
        AS a(key, number)
      ON CONFLICT (user_id, key) DO NOTHING`;

    // D-125: season points are the rarity of every dropped card (the season rating).
    const points = items.reduce((sum, item) => sum + item.card.rarityScore, 0);
    await tx.$executeRaw`
      INSERT INTO user_season_stats
        (id, user_id, season_id, spins_count, cards_issued, best_rarity, points)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${seasonId}::uuid, ${count}, ${count},
        ${bestRarity}, ${points})
      ON CONFLICT (user_id, season_id) DO UPDATE SET
        spins_count = user_season_stats.spins_count + EXCLUDED.spins_count,
        cards_issued = user_season_stats.cards_issued + EXCLUDED.cards_issued,
        best_rarity = GREATEST(user_season_stats.best_rarity, EXCLUDED.best_rarity),
        points = user_season_stats.points + EXCLUDED.points`;

    // D-133: medals for the dropped cards, the spin count, the level and the net worth.
    const season = await this.seasons.current();
    const achievements = await this.achievements.record(
      tx,
      updatedUser,
      {
        cards: items.map((item) => ({
          tier: item.card.tier,
          patterns: item.card.patterns.map((p) => p.id),
        })),
        totalSpins: player.totalSpins,
        level,
        netWorthRub: await netWorthRub(tx, userId),
      },
      { config, seasonId, seasonName: season.name },
    );

    const wallets = await tx.wallet.findMany({ where: { userId }, orderBy: { currency: 'asc' } });
    return {
      spins: items,
      achievements,
      exp: { gained: expGained, total: exp, level, leveledUp: level > user.level },
      wallets: wallets.map((w) => ({ currency: w.currency, balance: toApiMoney(w.balance) })),
      paymentCard: charge.cardRef
        ? { id: charge.cardRef.id, balance: toApiMoney(charge.cardBalance ?? 0n) }
        : null,
      freeSpins: {
        available: charge.freeSpins.available,
        nextAt: nextFreeSpinAt(charge.freeSpins, config)?.toISOString() ?? null,
      },
      luckMeter: { value: packCounters.luckMeter, max: config.luck.meterMax },
    };
  }

  /** Wallet plus active cards of the player in one currency (D-116). */
  private async totalBalance(tx: Tx, userId: string, currency: string): Promise<number> {
    const [wallet, cards] = await Promise.all([
      tx.wallet.findUnique({ where: { userId_currency: { userId, currency } } }),
      tx.card.aggregate({
        where: { ownerId: userId, currency, status: CardStatus.active },
        _sum: { balance: true },
      }),
    ]);
    return Number((wallet?.balance ?? 0n) + (cards._sum.balance ?? 0n));
  }

  /** Persists the rolled card (a new row, or the reused pooled one) and issues its balance via the ledger. */
  private async issueCard(
    tx: Tx,
    rolled: Awaited<ReturnType<typeof resolveSpin>>['card'],
    ctx: { userId: string; seasonId: string; now: Date; spinId: string },
  ): Promise<Card> {
    const cardData = {
      seasonId: ctx.seasonId,
      ownerId: ctx.userId,
      tier: rolled.tier,
      numberPatterns: rolled.patterns as unknown as Prisma.InputJsonValue,
      rarityScore: rolled.rarityScore,
      baseLimit: BigInt(rolled.baseLimit),
      initialBalance: BigInt(rolled.balance),
      // D-147: the luck points at the drop (history; the live value follows the config).
      luckBonusBp: rolled.luckPoints,
      status: CardStatus.active,
      ownersCount: rolled.ownersCount,
      extendedCount: 0,
      issuedAt: ctx.now,
      expiresAt: addHours(ctx.now, rolled.lifespanHours),
      graceUntil: null,
      pooledAt: null,
      heldAt: null,
      spinWindowStartedAt: null,
      spinsInWindow: 0,
    };
    const card = rolled.poolCardId
      ? await tx.card.update({ where: { id: rolled.poolCardId }, data: cardData })
      : await tx.card.create({
          data: {
            ...cardData,
            bankId: rolled.bankId,
            region: rolled.region,
            currency: rolled.currency,
            number: rolled.number,
          },
        });
    const cardRef = { type: LedgerAccountType.card, id: card.id };
    const balances = await this.ledger.post(
      tx,
      [
        {
          account: cardRef,
          delta: BigInt(rolled.balance),
          reason: LedgerReason.card_issue,
          ref: { type: 'spin', id: ctx.spinId },
        },
      ],
      { seasonId: ctx.seasonId },
    );
    return { ...card, balance: balances.get(accountKey(cardRef)) ?? 0n };
  }

  private async charge(
    tx: Tx,
    ctx: {
      user: User;
      pack: PackConfig;
      price: number;
      count: number;
      currency: Currency;
      request: Omit<SpinRequest, 'idempotencyKey'>;
      batchId: string;
      seasonId: string;
      now: Date;
      config: GameConfig;
    },
  ): Promise<Charge> {
    const { user, pack, price, count, currency, request, batchId, seasonId, now, config } = ctx;
    const freeSpins = accrueFreeSpins(
      { available: user.freeSpinsAvailable, anchorAt: user.freeSpinsAnchorAt },
      now,
      config,
    );
    const ref = { type: 'spin_batch', id: batchId };
    const total = BigInt(price) * BigInt(count);

    if (pack.free) {
      if (freeSpins.available < count)
        throw new AppError(ErrorCode.NO_FREE_SPINS, HttpStatus.CONFLICT);
      return {
        source: SpinPaymentSource.free,
        payment: { type: 'wallet' },
        cardRef: null,
        cardBalance: null,
        freeSpins: { ...freeSpins, available: freeSpins.available - count },
      };
    }

    if (request.payment.type === 'wallet') {
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId: user.id, currency } },
      });
      await this.ledger.post(
        tx,
        [
          {
            account: { type: LedgerAccountType.wallet, id: wallet.id },
            delta: -total,
            reason: LedgerReason.spin_cost,
            ref,
          },
        ],
        { seasonId },
      );
      return {
        source: SpinPaymentSource.wallet,
        payment: { type: 'wallet' },
        cardRef: null,
        cardBalance: null,
        freeSpins,
      };
    }

    const card = await tx.card.findUnique({ where: { id: request.payment.cardId } });
    if (!card || card.ownerId !== user.id)
      throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
    if (card.status !== CardStatus.active || card.expiresAt <= now) {
      throw new AppError(ErrorCode.CARD_EXPIRED, HttpStatus.CONFLICT);
    }
    if (card.heldAt === null || card.currency !== currency)
      throw new AppError(ErrorCode.CARD_NOT_USABLE);
    // D-121: a card pays for a limited number of spins per window (the wallet has no limit).
    const window = chargeCardSpins(
      { windowStartedAt: card.spinWindowStartedAt, spinsInWindow: card.spinsInWindow },
      config.cardSpinLimit,
      now,
      count,
    );
    if (!window) throw new AppError(ErrorCode.CARD_SPIN_LIMIT, HttpStatus.CONFLICT);
    await tx.card.update({
      where: { id: card.id },
      data: { spinWindowStartedAt: window.windowStartedAt, spinsInWindow: window.spinsInWindow },
    });
    const cardRef = { type: LedgerAccountType.card, id: card.id };
    const balances = await this.ledger.post(
      tx,
      [{ account: cardRef, delta: -total, reason: LedgerReason.spin_cost, ref }],
      { seasonId },
    );
    return {
      source: SpinPaymentSource.card,
      payment: { type: 'card', luckPoints: liveLuckPoints(card, config) },
      cardRef,
      cardBalance: balances.get(accountKey(cardRef)) ?? null,
      freeSpins,
    };
  }
}

/** Every spin-counted bonus loses one spin per spin of the batch; timed ones just expire. */
async function consumeBuffs(tx: Tx, buffs: readonly UserBuff[], count: number): Promise<void> {
  for (const buff of buffs) {
    if (buff.spinsLeft === null) continue;
    await tx.userBuff.update({
      where: { id: buff.id },
      data: { spinsLeft: Math.max(0, buff.spinsLeft - count) },
    });
  }
}

/** A number is taken while any card row holds it, pooled cards included (D-029). */
export function uniquenessIn(tx: Tx): UniquenessChecker {
  return {
    isNumberFree: async (number, cell) =>
      (await tx.card.count({ where: { number, bankId: cell.bankId, tier: cell.tier } })) === 0,
  };
}

/** Oldest pooled card of the tier and region; SKIP LOCKED lets parallel spins take different ones. */
function poolIn(tx: Tx): CardPool {
  return {
    async takeOldest(tier: Tier, region: Region): Promise<PooledCard | null> {
      const rows = await tx.$queryRaw<
        { id: string; number: string; bank_id: string; owners_count: number }[]
      >`
        SELECT id::text, number, bank_id, owners_count FROM cards
        WHERE status = 'pooled' AND tier = ${tier}::"Tier" AND region = ${region}::"Region"
        ORDER BY pooled_at ASC NULLS FIRST
        LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const row = rows[0];
      return row
        ? { id: row.id, number: row.number, bankId: row.bank_id, ownersCount: row.owners_count }
        : null;
    },
  };
}
