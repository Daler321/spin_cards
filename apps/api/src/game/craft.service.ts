import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { addHours, resolveCraft } from '@spincards/game-core';
import {
  type CraftRequest,
  type CraftResponse,
  type Currency,
  ErrorCode,
  isUpgradeTier,
} from '@spincards/shared';
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
} from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, type AccountRef, LedgerService } from '../ledger/ledger.service.js';
import { effectiveCard, toCardView } from './card-view.js';
import { CardsService } from './cards.service.js';
import { cryptoRng } from './crypto-rng.js';
import { lockPlayer } from './player-lock.js';
import { uniquenessIn } from './spin.service.js';

/**
 * D-170: N held cards of one tier and currency become one new card. Their balances go to the
 * wallet (the usual cash-out fee), the craft fee is paid from it, and the server rolls the chance
 * of one tier up before anything is shown. The used cards leave the game (status `crafted`).
 */
@Injectable()
export class CraftService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
    private readonly cards: CardsService,
  ) {}

  async craft(userId: string, request: CraftRequest): Promise<CraftResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const craft = config.craft;
    if (!craft || !(await this.flags.isEnabled('craft_enabled')))
      throw new AppError(ErrorCode.NOT_AVAILABLE, HttpStatus.CONFLICT);
    const seasonId = await this.seasons.currentSeasonId();
    const ids = [...new Set(request.cardIds)].sort();
    return this.idempotency.run(
      { userId, key: request.idempotencyKey, route: 'card.craft', payload: { cardIds: ids } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const now = new Date();
        const rows = await tx.card.findMany({ where: { id: { in: ids } } });
        const cards = rows
          .map((row) => effectiveCard(row, now, config))
          .filter(
            (c): c is Card =>
              c !== null &&
              c.ownerId === userId &&
              c.status === CardStatus.active &&
              c.heldAt !== null,
          );
        const first = cards[0];
        if (
          !first ||
          ids.length !== craft.cards ||
          cards.length !== ids.length ||
          !isUpgradeTier(first.tier) ||
          cards.some((c) => c.tier !== first.tier || c.currency !== first.currency)
        )
          throw new AppError(ErrorCode.CRAFT_INVALID_CARDS);
        const tier = first.tier;
        const currency = first.currency as Currency;

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency } },
        });
        const walletRef: AccountRef = { type: LedgerAccountType.wallet, id: wallet.id };
        const { payout } = await this.cards.cashOutCards(
          tx,
          user,
          cards,
          walletRef,
          { config, seasonId, now },
          CardStatus.crafted,
        );
        const craftId = randomUUID();
        const ref = { type: 'craft', id: craftId };
        const fee = BigInt(craft.fee[tier][currency]);
        // Throws INSUFFICIENT_FUNDS (and rolls everything back) when the wallet cannot pay.
        await this.ledger.post(
          tx,
          [{ account: walletRef, delta: -fee, reason: LedgerReason.craft_fee, ref }],
          { seasonId },
        );

        const outcome = await resolveCraft(config, craft, first.region, tier, {
          rng: cryptoRng,
          uniqueness: uniquenessIn(tx),
        });
        const forged = outcome.card;
        const created = await tx.card.create({
          data: {
            seasonId,
            ownerId: userId,
            bankId: forged.bankId,
            region: forged.region,
            currency: forged.currency,
            tier: forged.tier,
            number: forged.number,
            numberPatterns: forged.patterns as unknown as Prisma.InputJsonValue,
            rarityScore: forged.rarityScore,
            baseLimit: BigInt(forged.baseLimit),
            initialBalance: BigInt(forged.balance),
            luckBonusBp: forged.luckPoints,
            status: CardStatus.active,
            issuedAt: now,
            expiresAt: addHours(now, forged.lifespanHours),
            // The used cards free their slots: the new one is kept at once.
            heldAt: now,
          },
        });
        const cardRef = { type: LedgerAccountType.card, id: created.id };
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: cardRef,
              delta: BigInt(forged.balance),
              reason: LedgerReason.card_issue,
              ref,
            },
          ],
          { seasonId },
        );
        await tx.cardCraft.create({
          data: {
            id: craftId,
            userId,
            seasonId,
            tier,
            inputCardIds: ids,
            success: outcome.success,
            resultCardId: created.id,
            currency,
            fee,
          },
        });
        const walletBalance = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        return {
          success: outcome.success,
          card: toCardView(
            { ...created, balance: balances.get(accountKey(cardRef)) ?? 0n },
            config,
            user.level,
          ),
          consumedCardIds: ids,
          payout: toApiMoney(payout),
          fee: toApiMoney(fee),
          wallet: { currency, balance: toApiMoney(walletBalance.balance) },
        };
      },
    );
  }
}
