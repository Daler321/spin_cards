import type { CardView, HolderView, MeResponse, PublicConfigResponse } from '@spincards/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewConversion } from '../src/lib/conversion';
import { addStep, minorToInput, parseMajorToMinor } from '../src/lib/money';
import { describeReward } from '../src/lib/rewards';
import HolderScreen from '../src/screens/HolderScreen';
import { useSession } from '../src/state/session';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

const config = {
  conversion: {
    minAmount: { RUB: 10_000, USD: 100 },
    minFee: { RUB: 1000, USD: 12 },
    dailyLimit: { RUB: 50_000_000, USD: 550_000 },
    rates: [
      { fromCurrency: 'RUB', toCurrency: 'USD', rateNano: '11111111', feeBp: 300 },
      { fromCurrency: 'USD', toCurrency: 'RUB', rateNano: '90000000000', feeBp: 300 },
    ],
  },
  banks: [{ id: 'lemon', region: 'RU', color: 'yellow', name: 'Лимон Банк' }],
  holders: [
    { id: 'basic', slots: 5, unlockLevel: 1, prices: {}, starsPrice: null },
    { id: 'leather', slots: 5, unlockLevel: 4, prices: { RUB: 2_000_000 }, starsPrice: null },
  ],
} as unknown as PublicConfigResponse;

describe('previewConversion', () => {
  it('matches the server formula (1 000 ₽ -> $10.77, fee 30 ₽)', () => {
    expect(previewConversion(config, 'RUB', 'USD', 100_000)).toMatchObject({
      fee: 3000,
      result: 1077,
      belowMinimum: false,
    });
    expect(previewConversion(config, 'RUB', 'USD', 9_999)?.belowMinimum).toBe(true);
    expect(previewConversion(config, 'USD', 'RUB', 1077)).toMatchObject({
      fee: 33,
      result: 93_960,
    });
  });
});

describe('parseMajorToMinor', () => {
  it('accepts commas, spaces and up to two decimals', () => {
    expect(parseMajorToMinor('1 234,5')).toBe(123_450);
    expect(parseMajorToMinor('10.99')).toBe(1099);
    expect(parseMajorToMinor('0')).toBeNull();
    expect(parseMajorToMinor('1.234')).toBeNull();
    expect(parseMajorToMinor('abc')).toBeNull();
  });
});

describe('amount steps', () => {
  it('first tap sets the step, next taps add it, capped by the available amount', () => {
    expect(addStep(null, 100_000, 1_000_000)).toBe(100_000);
    expect(addStep(100_000, 100_000, 1_000_000)).toBe(200_000);
    expect(addStep(950_000, 100_000, 1_000_000)).toBe(1_000_000);
    expect(minorToInput(200_000)).toBe('2000');
    expect(minorToInput(1050)).toBe('10.50');
    expect(parseMajorToMinor(minorToInput(1050))).toBe(1050);
  });
});

describe('describeReward', () => {
  it('describes money, buffs, free spins and guarantees', () => {
    const text = describeReward(
      i18next.t,
      { money: { RUB: 300_000 }, guaranteedFloor: 'epic' },
      'RUB',
    );
    expect(nbsp(text)).toBe('+3 000 ₽ · Следующий прокрут: Epic или выше');
    expect(describeReward(i18next.t, { luck: { points: 10, spins: 3 } }, 'RUB')).toBe(
      '+10 удачи на 3 прокрута',
    );
    expect(describeReward(i18next.t, { freeSpins: 1 }, 'RUB')).toBe('+1 бесплатный прокрут');
  });
});

describe('holder screen', () => {
  const card = (over: Partial<CardView>): CardView => ({
    id: 'c1',
    number: '9123456712349999',
    bankId: 'lemon',
    region: 'RU',
    currency: 'RUB',
    tier: 'rare',
    patterns: [],
    rarityScore: 3,
    balance: 1500,
    initialBalance: 90_000,
    luckPoints: 30,
    ownersCount: 1,
    status: 'active',
    held: true,
    issuedAt: '2026-10-13T00:00:00Z',
    expiresAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    graceUntil: null,
    extendedCount: 0,
    cashoutValue: 1350,
    spinLimit: { left: 250, max: 250, resetsAt: null },
    trophyPrice: 500_000,
    design: null,
    ...over,
  });
  const holder: HolderView = {
    cards: [
      card({ id: 'small' }),
      card({
        id: 'old',
        status: 'expired',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        graceUntil: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ],
    pending: [],
    slots: { used: 2, total: 5 },
    ownedHolders: ['basic'],
    collection: { score: 6, level: 1, nextLevelScore: 25 },
  };
  const me = { firstName: 'Аня', region: 'RU', level: 1, wallets: [] } as unknown as MeResponse;

  beforeEach(() => {
    useSession.getState().setTokens({ accessToken: 'a', refreshToken: 'r' });
    vi.stubGlobal('fetch', (url: string) => {
      const path = url.replace('/api', '');
      const data =
        path === '/v1/me'
          ? me
          : path === '/v1/cards'
            ? holder
            : path === '/v1/config/public'
              ? config
              : {};
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists every held card, including tiny and expired ones, with slots and holders', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <HolderScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Места 2 / 5')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.className === 'card-tile')).toHaveLength(
      2,
    );
    expect(screen.getByText(/Сгорит через/)).toBeTruthy();
    expect(screen.getByText('Кожаный')).toBeTruthy();
    expect(screen.getByText('С 4 уровня')).toBeTruthy();
    expect(screen.getByText('Коллекция: ур. 1')).toBeTruthy();
  });
});
