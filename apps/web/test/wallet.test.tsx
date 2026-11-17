import type { CardView, HolderView, MeResponse, PublicConfigResponse } from '@spincards/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletPrompt } from '../src/components/WalletPrompt';
import { walletCoverage } from '../src/lib/useWalletGuard';
import WalletScreen from '../src/screens/WalletScreen';
import { useWalletPrompt } from '../src/state/walletPrompt';
import { useSession } from '../src/state/session';

const card = (id: string, last4: string, balance: number): CardView => ({
  id,
  number: `912345671234${last4}`,
  bankId: 'lemon',
  region: 'RU',
  currency: 'RUB',
  tier: 'rare',
  patterns: [],
  rarityScore: 5,
  balance,
  initialBalance: balance,
  luckPoints: 12,
  ownersCount: 1,
  status: 'active',
  held: true,
  issuedAt: '2026-10-13T00:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
  graceUntil: null,
  extendedCount: 0,
  cashoutValue: balance,
  spinLimit: { left: 250, max: 250, resetsAt: null },
  trophyPrice: 0,
  design: null,
});

const me = {
  region: 'RU',
  level: 5,
  wallets: [
    { currency: 'RUB', balance: 500_000 },
    { currency: 'USD', balance: 0 },
  ],
  game: { cashoutFeeBp: 1000 },
} as unknown as MeResponse;

const config = {
  p2p: {
    feeBp: 500,
    minLevel: 3,
    minAmount: { RUB: 10_000, USD: 100 },
    dailyLimit: { RUB: 10_000_000, USD: 100_000 },
  },
  conversion: { rates: [], minFee: { RUB: 0, USD: 0 }, minAmount: { RUB: 10_000, USD: 100 } },
} as unknown as PublicConfigResponse;

let historyCursor: string | null = null;

const holder = {
  cards: [card('small', '1111', 200_000), card('big', '2222', 3_000_000)],
  pending: [],
} as unknown as HolderView;

describe('wallet screen', () => {
  const calls: { path: string; body: unknown }[] = [];

  beforeEach(() => {
    calls.length = 0;
    historyCursor = null;
    useSession.getState().setTokens({ accessToken: 'a', refreshToken: 'r' });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, body });
      const json = (data: unknown) =>
        Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
      if (path === '/v1/me') return json(me);
      if (path === '/v1/config/public') return json(config);
      if (path === '/v1/cards') return json(holder);
      if (path.startsWith('/v1/wallet/history')) {
        return json({
          items: [
            {
              id: 'h1',
              currency: 'RUB',
              delta: 3_000_000,
              balanceAfter: 3_000_000,
              reason: 'signup_bonus',
              createdAt: '2026-10-24T10:00:00Z',
            },
          ],
          nextCursor: historyCursor,
        });
      }
      if (path === '/v1/transfers') {
        return json({
          amount: 1_000_000,
          fee: 100_000,
          received: 900_000,
          wallet: { currency: 'RUB', balance: 1_400_000 },
          cards: [],
        });
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderScreen = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WalletScreen />
      </QueryClientProvider>,
    );

  it('splits operations into tabs', async () => {
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Найти' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Обмен валют' }));
    expect(await screen.findByRole('button', { name: 'Обменять' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Найти' })).toBeNull();
  });

  it('always shows the history at the bottom, under either operation', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'История операций' })).toBeTruthy();
    expect(await screen.findByText('Стартовый бонус')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Обмен валют' }));
    expect(screen.getByText('Стартовый бонус')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'История' })).toBeNull();
  });

  it('offers the next history page when there is one', async () => {
    historyCursor = 'h0';
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Показать ещё' })).toBeTruthy();
  });

  it('tops the wallet up from the picked card, the richest first', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: /^Кошелёк 5\s000\s₽/ }));
    const big = await screen.findByRole('radio', { name: 'Карта •••• 2222' });
    expect(big.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '10 000 ₽'.replace(/ /g, ' ') }));
    expect(await screen.findByText(/получите 9\s000\s₽/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Перевести в кошелёк' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === '/v1/transfers')?.body).toMatchObject({
        from: { type: 'card', cardId: 'big' },
        to: { type: 'wallet' },
        amount: 1_000_000,
      });
    });
    // The sheet closes after the transfer.
    await waitFor(() => {
      expect(screen.queryByRole('radio', { name: 'Карта •••• 2222' })).toBeNull();
    });
  });

  it('asks to top the wallet up with the missing amount, the cash-out fee included', async () => {
    useWalletPrompt.getState().ask({ currency: 'RUB', price: 3_000_000 });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WalletPrompt />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Покупки оплачиваются с кошелька/)).toBeTruthy();
    // 25 000 ₽ are missing: 27 777,78 ₽ from the card leave exactly that after the 10 % fee.
    const big = await screen.findByRole('radio', { name: 'Карта •••• 2222' });
    expect(big.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByPlaceholderText<HTMLInputElement>('Сумма').value).toBe('27777.78');
    expect(await screen.findByText(/получите 25\s000\s₽/)).toBeTruthy();
    useWalletPrompt.getState().close();
  });
});

describe('wallet coverage (D-166)', () => {
  const held = (balance: number) => ({ balance }) as CardView;
  it('tells the wallet, a top-up from the cards and not enough apart', () => {
    expect(walletCoverage(1000, [], 1000, 1000)).toBe('wallet');
    expect(walletCoverage(500, [held(600)], 1000, 1000)).toBe('topup');
    // 550 on the card gives 495 after the fee: 5 short.
    expect(walletCoverage(500, [held(550)], 1000, 1000)).toBe('short');
  });
});
