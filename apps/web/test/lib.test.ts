import type { CardView, PublicConfigResponse } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatExpiry,
  formatMoney,
  formatPercentBp,
  numberBlocks,
} from '../src/lib/format';
import { previewLuck } from '../src/lib/luck';
import { packPrice, usableCards, visiblePacks } from '../src/lib/packs';
import { digitMarks } from '../src/lib/patterns';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('format', () => {
  it('formats money from minor units', () => {
    expect(nbsp(formatMoney(123_456, 'RUB'))).toBe('1 234,56 ₽');
    expect(nbsp(formatMoney(100_000, 'RUB'))).toBe('1 000 ₽');
    expect(nbsp(formatMoney(1200, 'USD'))).toBe('12 $');
  });

  it('splits card numbers and formats expiry, percent and countdowns', () => {
    expect(numberBlocks('9123456789012345')).toEqual(['9123', '4567', '8901', '2345']);
    expect(formatExpiry('2026-11-03T10:00:00Z')).toBe('03.11');
    expect(nbsp(formatPercentBp(650))).toBe('6,5 %');
    expect(formatCountdown(3_909_000)).toBe('1:05:09');
    expect(formatCountdown(249_000)).toBe('4:09');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('digitMarks', () => {
  it('marks pattern digits and long ladders', () => {
    const marks = digitMarks([
      { id: 'quad', start: 4, length: 4 },
      { id: 'long_ladder_6', start: 9, length: 6 },
    ]);
    expect(marks.slice(0, 4)).toEqual(['plain', 'plain', 'plain', 'plain']);
    expect(marks.slice(4, 8)).toEqual(['pattern', 'pattern', 'pattern', 'pattern']);
    expect(marks.slice(9, 15)).toEqual(Array(6).fill('ladder'));
    expect(marks[15]).toBe('plain');
  });
});

describe('packs and payment', () => {
  const config = {
    packs: [
      { id: 'free', free: true, prices: { RUB: 0, USD: 0 } },
      { id: 'basic', free: false, prices: { RUB: 100_000, USD: 1200 } },
      { id: 'vip', free: false, prices: {} },
    ],
  } as unknown as PublicConfigResponse;

  it('hides Stars-only packs and prices by currency', () => {
    const packs = visiblePacks(config, 'USD');
    expect(packs.map((p) => p.id)).toEqual(['free', 'basic']);
    expect(packPrice(packs[1]!, 'USD')).toBe(1200);
    expect(packPrice(packs[0]!, 'USD')).toBe(0);
  });

  it('offers only held, active cards of the currency that cover the price', () => {
    const now = Date.parse('2026-10-13T00:00:00Z');
    const card = (over: Partial<CardView>) =>
      ({
        id: 'x',
        held: true,
        status: 'active',
        currency: 'RUB',
        balance: 200_000,
        expiresAt: '2026-10-20T00:00:00Z',
        ...over,
      }) as CardView;
    const cards = [
      card({ id: 'ok' }),
      card({ id: 'pending', held: false }),
      card({ id: 'poor', balance: 50_000 }),
      card({ id: 'usd', currency: 'USD' }),
      card({ id: 'old', expiresAt: '2026-10-12T00:00:00Z' }),
    ];
    expect(usableCards(cards, 'RUB', 100_000, now).map((c) => c.id)).toEqual(['ok']);
  });

  it('previews the luck: card + bonus points, × the strongest running multiplier (D-147)', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    const bonus = { points: 10, multiplierBp: null, spinsLeft: 3, expiresAt: null, packId: null };
    const stars = (multiplierBp: number, expiresAt: string) => ({
      points: null,
      multiplierBp,
      spinsLeft: null,
      expiresAt,
      packId: null,
    });
    expect(previewLuck(30, [bonus], 100, now, 'basic')).toMatchObject({
      total: 40,
      card: 30,
      bonus: 10,
    });
    expect(
      previewLuck(30, [bonus, stars(15_000, '2026-10-17T13:00:00Z')], 100, now, 'basic').total,
    ).toBe(60);
    // An expired multiplier no longer counts; the total never passes the maximum.
    expect(previewLuck(30, [stars(30_000, '2026-10-17T11:00:00Z')], 100, now, 'basic').total).toBe(
      30,
    );
    expect(previewLuck(80, [stars(200_000, '2026-10-17T13:00:00Z')], 100, now, 'basic').total).toBe(
      100,
    );
    // An old shop buff of another pack does not count here.
    const oldShop = {
      points: 20,
      multiplierBp: null,
      spinsLeft: 5,
      expiresAt: null,
      packId: 'basic',
    };
    expect(previewLuck(0, [oldShop], 100, now, 'premium').total).toBe(0);
    expect(previewLuck(0, [oldShop], 100, now, 'basic').total).toBe(20);
  });
});

describe('newIdempotencyKey', () => {
  it('builds RFC 4122 v4 ids accepted by the api', async () => {
    const { newIdempotencyKey } = await import('../src/api/client');
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(200);
    for (const key of keys)
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
