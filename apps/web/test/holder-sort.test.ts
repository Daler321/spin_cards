import type { CardView } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import { arrangeCards } from '../src/lib/holderSort';

const card = (id: string, patch: Partial<CardView>): CardView =>
  ({
    id,
    currency: 'RUB',
    rarityScore: 0,
    balance: 0,
    status: 'active',
    expiresAt: '2026-10-20T00:00:00Z',
    graceUntil: null,
    ...patch,
  }) as CardView;

const cards = [
  card('a', { rarityScore: 5, balance: 900, expiresAt: '2026-10-18T00:00:00Z' }),
  card('b', { rarityScore: 20, balance: 100, expiresAt: '2026-10-19T00:00:00Z' }),
  card('c', { rarityScore: 1, balance: 5000, currency: 'USD' }),
  card('d', {
    status: 'expired',
    expiresAt: '2026-10-12T00:00:00Z',
    graceUntil: '2026-10-14T00:00:00Z',
  }),
];
const ids = (list: CardView[]) => list.map((c) => c.id).join('');

describe('arrangeCards', () => {
  it('sorts by rarity, balance or burn time and filters by currency', () => {
    expect(ids(arrangeCards(cards, 'rarity', 'all'))).toBe('bacd');
    expect(ids(arrangeCards(cards, 'balance', 'all'))).toBe('cabd');
    expect(ids(arrangeCards(cards, 'time', 'all'))).toBe('dabc');
    expect(ids(arrangeCards(cards, 'rarity', 'USD'))).toBe('c');
    expect(ids(arrangeCards(cards, 'balance', 'RUB'))).toBe('abd');
  });

  it('compares balances across currencies in rubles', () => {
    const rates = [{ fromCurrency: 'USD', toCurrency: 'RUB', rateNano: '90000000000', feeBp: 300 }];
    const mixed = [
      card('rub', { balance: 500_000 }), // 5 000 ₽
      card('usd', { balance: 10_000, currency: 'USD' }), // $100 ≈ 9 000 ₽
    ];
    expect(ids(arrangeCards(mixed, 'balance', 'all', rates))).toBe('usdrub');
  });
});
