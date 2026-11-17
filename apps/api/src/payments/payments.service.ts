import { HttpStatus, Injectable } from '@nestjs/common';
import { extensionHours, isWheelAvailable } from '@spincards/game-core';
import {
  CARD_STARS_PRODUCTS,
  CURRENCIES,
  ErrorCode,
  type GameConfig,
  parseStarsProduct,
  resources,
  type StarsProductRef,
  starsPrice,
  type Tier,
  type PreCheckoutRequest,
  type PreCheckoutResponse,
  type StarsInvoiceResponse,
  type SuccessfulPaymentRequest,
  type SuccessfulPaymentResponse,
} from '@spincards/shared';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { CardsService } from '../game/cards.service.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { grantReward } from '../game/grant-reward.js';
import { lockPlayer } from '../game/player-lock.js';
import {
  LedgerAccountType,
  LedgerReason,
  PaymentStatus,
  type StarProduct,
} from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { isUniqueViolation, PrismaService, type Tx } from '../prisma/prisma.service.js';
import { TelegramApiService } from './telegram-api.service.js';

const STARS_CURRENCY = 'XTR';

const money = z.number().int().positive();
const ProductPayloadSchema = z.object({
  title: z.string().min(1).max(32).optional(),
  description: z.string().min(1).max(255).optional(),
  /** currency_bundle: amount per currency; the player's region currency is credited. */
  money: z.partialRecord(z.enum(CURRENCIES), money).optional(),
  /** buff: a luck buff for any pack. */
  boostBp: money.optional(),
  spins: money.optional(),
  /** free_spins: extra free spins (over the stored cap). */
  count: money.optional(),
});

/**
 * Telegram Stars (TZ 9), hidden behind `stars_enabled`. The api creates a pending payment and an
 * invoice link (payload = payment id); the bot validates pre_checkout_query and reports
 * successful_payment, which credits the product through the ledger exactly once per charge id.
 * A charge Telegram already took is credited even if the flag was switched off meanwhile.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FlagsService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly ledger: LedgerService,
    private readonly telegram: TelegramApiService,
    private readonly cards: CardsService,
  ) {}

  async createInvoice(
    userId: string,
    productId: string,
    idempotencyKey: string,
    cardId?: string,
  ): Promise<StarsInvoiceResponse> {
    if (!(await this.flags.isEnabled('stars_enabled')))
      throw new AppError(ErrorCode.PAYMENTS_DISABLED, HttpStatus.FORBIDDEN);
    const catalog = parseStarsProduct(productId);
    let stars: number;
    let invoice: { title: string; description: string };
    if (catalog) {
      // D-146: a product of the economy config; its price can depend on the card or chest level.
      const { config } = await this.config.active();
      const quote = await this.quote(this.prisma, userId, catalog, cardId ?? null, config);
      stars = quote.stars;
      invoice = quote.invoice;
      await this.prisma.starProduct.upsert({
        where: { id: productId },
        create: { id: productId, kind: catalog.kind, refId: catalog.ref, starsPrice: stars },
        update: {},
      });
    } else {
      const product = await this.prisma.starProduct.findUnique({ where: { id: productId } });
      if (!product?.isActive || !isSupported(product))
        throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, HttpStatus.NOT_FOUND);
      const payload = ProductPayloadSchema.parse(product.payload);
      stars = product.starsPrice;
      invoice = {
        title: payload.title ?? product.id,
        description: payload.description ?? payload.title ?? product.id,
      };
    }

    const key = `${userId}:${idempotencyKey}`;
    let payment = await this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
    if (payment && (payment.userId !== userId || payment.productId !== productId))
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, HttpStatus.CONFLICT);
    if (!payment) {
      try {
        payment = await this.prisma.payment.create({
          data: {
            userId,
            productId,
            status: PaymentStatus.pending,
            starsAmount: stars,
            idempotencyKey: key,
            payload: cardId ? { cardId } : {},
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: key } });
      }
    }

    const invoiceLink = await this.telegram.createInvoiceLink({
      ...invoice,
      payload: payment.id,
      starsAmount: payment.starsAmount,
    });
    return { paymentId: payment.id, invoiceLink };
  }

  /** Answer to pre_checkout_query: the payment is ours, pending, for this player and amount. */
  async preCheckout(request: PreCheckoutRequest): Promise<PreCheckoutResponse> {
    const invalid = { ok: false, error: ErrorCode.PAYMENT_INVALID };
    if (!(await this.flags.isEnabled('stars_enabled')))
      return { ok: false, error: ErrorCode.PAYMENTS_DISABLED };
    const payment = await this.findPayment(request.payload);
    if (!payment || payment.status !== PaymentStatus.pending) return invalid;
    if (payment.user.telegramId.toString() !== request.telegramId) return invalid;
    if (request.currency !== STARS_CURRENCY || request.totalAmount !== payment.starsAmount)
      return invalid;
    if (payment.user.isBanned) return invalid;
    const catalog = parseStarsProduct(payment.productId);
    if (catalog) {
      // The card may be gone or the album full since the invoice: check again before the charge.
      const { config } = await this.config.active();
      try {
        const quote = await this.quote(
          this.prisma,
          payment.userId,
          catalog,
          cardOf(payment.payload),
          config,
        );
        if (quote.stars !== payment.starsAmount) return invalid;
      } catch (error) {
        if (error instanceof AppError) return { ok: false, error: error.code };
        throw error;
      }
      return { ok: true };
    }
    if (!payment.product.isActive || !isSupported(payment.product)) return invalid;
    return { ok: true };
  }

  /** successful_payment: marks the payment paid and credits the product, once per charge. */
  async complete(request: SuccessfulPaymentRequest): Promise<SuccessfulPaymentResponse> {
    const payment = await this.findPayment(request.payload);
    if (!payment) throw new AppError(ErrorCode.PAYMENT_INVALID, HttpStatus.NOT_FOUND);
    if (
      payment.user.telegramId.toString() !== request.telegramId ||
      request.currency !== STARS_CURRENCY ||
      request.totalAmount !== payment.starsAmount
    )
      throw new AppError(ErrorCode.PAYMENT_INVALID, HttpStatus.CONFLICT);

    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    try {
      return await this.prisma.transaction(async (tx) => {
        await lockPlayer(tx, payment.userId);
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (current.status !== PaymentStatus.pending) {
          if (current.telegramPaymentChargeId === request.telegramPaymentChargeId)
            return {
              credited: false,
              productId: current.productId,
              ...(current.status === PaymentStatus.refunded && { refunded: true }),
            };
          throw new AppError(ErrorCode.PAYMENT_INVALID, HttpStatus.CONFLICT);
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.paid,
            paidAt: new Date(),
            telegramPaymentChargeId: request.telegramPaymentChargeId,
          },
        });
        await this.credit(tx, payment, config, seasonId);
        return { credited: true, productId: payment.productId };
      });
    } catch (error) {
      // D-146: Telegram has taken the Stars but the product cannot be given any more (the card
      // burned, the album filled up): the Stars go back to the player.
      if (!(error instanceof AppError) || error.code === ErrorCode.PAYMENT_INVALID) throw error;
      await this.telegram.refundStarPayment(request.telegramId, request.telegramPaymentChargeId);
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.pending },
        data: {
          status: PaymentStatus.refunded,
          refundedAt: new Date(),
          telegramPaymentChargeId: request.telegramPaymentChargeId,
        },
      });
      return { credited: false, refunded: true, productId: payment.productId };
    }
  }

  private async credit(
    tx: Tx,
    payment: {
      id: string;
      userId: string;
      productId: string;
      payload: unknown;
      product: StarProduct;
    },
    config: GameConfig,
    seasonId: string,
  ): Promise<void> {
    const { userId, product } = payment;
    const paymentId = payment.id;
    const catalog = parseStarsProduct(payment.productId);
    if (catalog) {
      await this.creditCatalog(
        tx,
        userId,
        catalog,
        cardOf(payment.payload),
        paymentId,
        config,
        seasonId,
      );
      return;
    }
    const payload = ProductPayloadSchema.parse(product.payload);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const ref = { type: 'payment', id: paymentId };
    switch (product.kind) {
      case 'currency_bundle': {
        const currency = config.regions[user.region].currency;
        const amount = payload.money?.[currency];
        if (!amount) throw new Error(`product ${product.id} has no ${currency} amount`);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency } },
        });
        await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.wallet, id: wallet.id },
              delta: BigInt(amount),
              reason: LedgerReason.stars_purchase,
              ref,
            },
          ],
          { seasonId },
        );
        return;
      }
      case 'holder': {
        if (!product.refId) throw new Error(`product ${product.id} has no holder`);
        const owned = await tx.userHolder.findFirst({ where: { userId, holderId: product.refId } });
        if (!owned)
          await tx.userHolder.create({
            data: { userId, holderId: product.refId, source: 'stars' },
          });
        return;
      }
      case 'buff':
      case 'free_spins': {
        await grantReward(
          this.ledger,
          {
            ...(payload.boostBp &&
              payload.spins && {
                luck: {
                  points: Math.max(1, Math.round(payload.boostBp / 100)),
                  spins: payload.spins,
                },
              }),
            ...(payload.count && { freeSpins: payload.count }),
          },
          {
            tx,
            user,
            config,
            seasonId,
            reason: LedgerReason.stars_purchase,
            ref,
            buffSource: 'stars',
          },
        );
        return;
      }
      default:
        throw new Error(`unsupported product kind ${product.kind}`);
    }
  }

  /**
   * D-146: the price of a catalog product for this player now, with the invoice texts; throws the
   * reason when it cannot be bought (card gone, album full, chest at the top, …).
   */
  private async quote(
    db: Tx | PrismaService,
    userId: string,
    product: StarsProductRef,
    cardId: string | null,
    config: GameConfig,
    now = new Date(),
  ): Promise<{ stars: number; invoice: { title: string; description: string } }> {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { holders: { select: { holderId: true } } },
    });
    const params: Record<string, string | number> = {};
    let cardTier: Tier | undefined;
    if (CARD_STARS_PRODUCTS.includes(product.kind)) {
      if (!cardId) throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
      const card = await this.cards.checkStarsCard(db, userId, product.kind, cardId, config, now);
      cardTier = card.tier;
      params.last4 = card.number.slice(-4);
      params.hours = extensionHours(config.tiers[card.tier].lifespanHours, config);
    }
    switch (product.kind) {
      case 'buff': {
        const buff = config.stars.buffs.find((b) => b.id === product.ref);
        if (buff) {
          params.mult = multiplier(buff.multiplierBp);
          params.minutes = buff.minutes;
          params.max = config.luck.maxPoints;
        }
        break;
      }
      case 'free_spins':
        params.count = config.stars.freeSpins.find((o) => o.id === product.ref)?.count ?? 0;
        break;
      case 'holder': {
        if (user.holders.some((h) => h.holderId === product.ref))
          throw new AppError(ErrorCode.HOLDER_ALREADY_OWNED, HttpStatus.CONFLICT);
        params.slots = config.holders.find((h) => h.id === product.ref)?.slots ?? 0;
        break;
      }
      case 'chest_upgrade':
        if (!config.chest.levels.some((l) => l.level === user.chestLevel + 1))
          throw new AppError(ErrorCode.CHEST_MAX_LEVEL, HttpStatus.CONFLICT);
        params.level = user.chestLevel + 1;
        break;
      case 'wheel_now':
        if (isWheelAvailable(user.wheelSpunAt, now, config))
          throw new AppError(ErrorCode.WHEEL_ALREADY_READY, HttpStatus.CONFLICT);
        break;
      default:
        break;
    }
    const stars = starsPrice(config, product, {
      chestLevel: user.chestLevel,
      ...(cardTier && { cardTier }),
    });
    if (stars === null) throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, HttpStatus.NOT_FOUND);
    return {
      stars,
      invoice: {
        title: invoiceText(product.kind, 'title', params).slice(0, 32),
        description: invoiceText(product.kind, 'description', params).slice(0, 255),
      },
    };
  }

  /** D-146: gives a catalog product, inside the payment's transaction. */
  private async creditCatalog(
    tx: Tx,
    userId: string,
    product: StarsProductRef,
    cardId: string | null,
    paymentId: string,
    config: GameConfig,
    seasonId: string,
  ): Promise<void> {
    const now = new Date();
    // Same checks as at the invoice: the state may have changed since.
    await this.quote(tx, userId, product, cardId, config, now);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const ref = { type: 'payment', id: paymentId };
    switch (product.kind) {
      case 'buff': {
        const buff = config.stars.buffs.find((b) => b.id === product.ref);
        if (!buff) throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, HttpStatus.NOT_FOUND);
        // D-147: a luck multiplier for some minutes, no purchase limit. Buying the same one while it
        // runs adds its time on top; the strongest running multiplier applies.
        const running = await tx.userBuff.findFirst({
          where: { userId, multiplierBp: buff.multiplierBp, expiresAt: { gt: now } },
          orderBy: { expiresAt: 'desc' },
        });
        const from = running?.expiresAt ?? now;
        await tx.userBuff.create({
          data: {
            userId,
            multiplierBp: buff.multiplierBp,
            spinsLeft: null,
            expiresAt: new Date(from.getTime() + buff.minutes * 60_000),
            source: 'stars',
          },
        });
        return;
      }
      case 'free_spins': {
        const offer = config.stars.freeSpins.find((o) => o.id === product.ref);
        if (!offer) throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, HttpStatus.NOT_FOUND);
        await grantReward(
          this.ledger,
          { freeSpins: offer.count },
          {
            tx,
            user,
            config,
            seasonId,
            reason: LedgerReason.stars_purchase,
            ref,
            buffSource: 'stars',
          },
        );
        return;
      }
      case 'holder':
        await tx.userHolder.create({
          data: { userId, holderId: product.ref ?? '', source: 'stars' },
        });
        return;
      case 'album_slot':
        await tx.user.update({ where: { id: userId }, data: { showcaseSlots: { increment: 1 } } });
        return;
      case 'chest_upgrade':
        await tx.user.update({
          where: { id: userId },
          data: { chestLevel: { increment: 1 } },
        });
        return;
      case 'wheel_now':
        await tx.user.update({ where: { id: userId }, data: { wheelSpunAt: null } });
        return;
      case 'card_limit_reset':
      case 'card_extend':
      case 'trophy':
        await this.cards.applyStarsCard(
          tx,
          userId,
          product.kind,
          cardId ?? '',
          config,
          seasonId,
          now,
        );
        return;
    }
  }

  private findPayment(payload: string) {
    if (!z.uuid().safeParse(payload).success) return Promise.resolve(null);
    return this.prisma.payment.findUnique({
      where: { id: payload },
      include: { user: true, product: true },
    });
  }
}

/** The card a card product was bought for. */
function cardOf(payload: unknown): string | null {
  const parsed = z.object({ cardId: z.uuid() }).safeParse(payload);
  return parsed.success ? parsed.data.cardId : null;
}

function multiplier(bp: number): string {
  return `×${String(bp / 10_000).replace('.', ',')}`;
}

/** Invoice texts (Telegram shows them on the payment form); plain `{name}` placeholders. */
function invoiceText(
  kind: StarsProductRef['kind'],
  field: 'title' | 'description',
  params: Record<string, string | number>,
): string {
  const template = resources.ru.shop.stars.invoice[kind][field];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

/** Kinds this release can credit; `pack` (a paid spin) waits for the payments milestone. */
function isSupported(product: StarProduct): boolean {
  return ['currency_bundle', 'holder', 'buff', 'free_spins'].includes(product.kind);
}
