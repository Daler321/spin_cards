import { cardLuckPoints, cashoutFeeBp, type PatternMatch } from '@spincards/game-core';
import { cardSpinUsage, type GameConfig, trophyCardDesign, trophyPrice } from '@spincards/shared';
import { toApiMoney } from '../common/money.js';
import { type Card, CardStatus } from '../generated/prisma/client.js';
import { payoutOf } from './money.js';
import type { CardView, PatternMatchView } from '@spincards/shared';

/**
 * The lifecycle job runs once a minute; until it does, a card past its expiry is treated as expired
 * (penalty fee, restorable) and one past its grace window as gone.
 */
export function effectiveCard(card: Card, now: Date, config: GameConfig): Card | null {
  if (card.status === CardStatus.active && card.expiresAt <= now) {
    const graceUntil = new Date(card.expiresAt.getTime() + config.lifecycle.graceHours * 3_600_000);
    card = { ...card, status: CardStatus.expired, graceUntil };
  }
  if (card.status === CardStatus.expired && card.graceUntil !== null && card.graceUntil <= now)
    return null;
  return card;
}

/**
 * The luck points a card gives when it pays, by the active config (D-138, D-147): tier plus number.
 * The value stored at the drop is history only, so economy changes reach cards already in holders.
 */
export function liveLuckPoints(card: Card, config: GameConfig): number {
  return cardLuckPoints(card.tier, card.numberPatterns as unknown as PatternMatch[], config);
}

/** Cash-out fee: level-based, or the penalty fee for an expired card. */
export function cardCashoutFeeBp(card: Card, config: GameConfig, level: number): number {
  return card.status === CardStatus.expired
    ? config.lifecycle.expiredCashoutFeeBp
    : cashoutFeeBp(level, config);
}

export function toCardView(card: Card, config: GameConfig, level: number): CardView {
  const feeBp = cardCashoutFeeBp(card, config, level);
  return {
    id: card.id,
    number: card.number,
    bankId: card.bankId,
    region: card.region,
    currency: card.currency,
    tier: card.tier,
    patterns: card.numberPatterns as unknown as PatternMatchView[],
    rarityScore: card.rarityScore,
    balance: toApiMoney(card.balance),
    initialBalance: toApiMoney(card.initialBalance),
    luckPoints: liveLuckPoints(card, config),
    ownersCount: card.ownersCount,
    status: card.status,
    held: card.heldAt !== null,
    issuedAt: card.issuedAt.toISOString(),
    expiresAt: card.expiresAt.toISOString(),
    graceUntil: card.graceUntil?.toISOString() ?? null,
    extendedCount: card.extendedCount,
    cashoutValue: toApiMoney(payoutOf(card.balance, feeBp)),
    spinLimit: spinLimitOf(card, config),
    trophyPrice: trophyPrice(card, card.currency, config),
    design: card.status === CardStatus.trophy ? trophyCardDesign(card.design) : null,
  };
}

function spinLimitOf(card: Card, config: GameConfig): CardView['spinLimit'] {
  const usage = cardSpinUsage(
    { windowStartedAt: card.spinWindowStartedAt, spinsInWindow: card.spinsInWindow },
    config.cardSpinLimit,
    new Date(),
  );
  return {
    left: usage.left,
    max: config.cardSpinLimit.spins,
    resetsAt: usage.resetsAt?.toISOString() ?? null,
  };
}
