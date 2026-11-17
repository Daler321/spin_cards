import type {
  CardView,
  HolderView,
  MeResponse,
  PublicConfigResponse,
  SpinResponse,
} from '@spincards/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RouletteScreen from '../src/screens/RouletteScreen';
import { useNavigation } from '../src/state/navigation';
import { useSession } from '../src/state/session';
import { useToast } from '../src/state/toast';
import { useWalletPrompt } from '../src/state/walletPrompt';

const card: CardView = {
  id: 'card-1',
  number: '9123456712349999',
  bankId: 'lemon',
  region: 'RU',
  currency: 'RUB',
  tier: 'epic',
  patterns: [{ id: 'tail_9999', start: 12, length: 4 }],
  rarityScore: 23,
  balance: 250_000,
  initialBalance: 250_000,
  luckPoints: 45,
  ownersCount: 1,
  status: 'active',
  held: false,
  issuedAt: '2026-10-13T00:00:00Z',
  expiresAt: '2026-10-20T00:00:00Z',
  graceUntil: null,
  extendedCount: 0,
  cashoutValue: 225_000,
  spinLimit: { left: 250, max: 250, resetsAt: null },
  trophyPrice: 500_000,
  design: null,
};

let me: MeResponse;
let configResponse: PublicConfigResponse;
let miniGamesEnabled: boolean;
const baseMe: MeResponse = {
  season: { name: 'Бета', endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString() },
  id: 'u1',
  telegramId: '1',
  username: null,
  firstName: 'Аня',
  photoUrl: null,
  region: 'RU',
  level: 1,
  exp: 0,
  nextLevelExp: 100,
  referralCode: 'ABCDEFGH',
  wallets: [
    { currency: 'RUB', balance: 500_000 },
    { currency: 'USD', balance: 0 },
  ],
  settings: { notificationsEnabled: true, hideFromLeaderboard: false, autoCashoutTiers: [] },
  createdAt: '2026-10-13T00:00:00Z',
  game: {
    freeSpins: { available: 3, nextAt: null },
    luckMeters: [{ packId: 'basic', value: 4, max: 30 }],
    buffs: [],
    guaranteedFloor: null,
    pendingCardId: null,
    daily: { streak: 1, claimedToday: true },
    totalSpins: 10,
    milestone: { value: 10, max: 500 },
    returnLuckyPending: false,
    questsReady: 0,
    chest: { available: 0, progress: 0, everySpins: 10, level: 1 },
    wheel: { availableAt: '2099-01-01T00:00:00Z' },
    cashoutFeeBp: 1000,
    albumIncome: null,
    nickBonus: null,
  },
};

const config = {
  configVersion: 1,
  packs: [
    { id: 'free', free: true, prices: { RUB: 0, USD: 0 }, unlockLevel: 1 },
    { id: 'basic', free: false, prices: { RUB: 100_000, USD: 1200 }, unlockLevel: 1 },
    { id: 'business', free: false, prices: { RUB: 1_500_000, USD: 17_000 }, unlockLevel: 3 },
  ],
  levels: [
    { level: 1, exp: 0 },
    { level: 2, exp: 100 },
  ],
  luck: { meterMax: 30, boostCapBp: 5000 },
  banks: [{ id: 'lemon', region: 'RU', color: 'yellow', name: 'Лимон Банк' }],
  wheel: { intervalHours: 4, segments: [] },
} as unknown as PublicConfigResponse;

const spin: SpinResponse = {
  spins: [
    {
      spinId: 's1',
      card,
      lucky: null,
      pityApplied: null,
      guaranteeApplied: false,
      autoCashedOut: null,
      nearMiss: { patternId: 'tail_7777', position: 15, digit: 7 },
    },
  ],
  achievements: [],
  exp: { gained: 20, total: 20, level: 1, leveledUp: false },
  wallets: [{ currency: 'RUB', balance: 400_000 }],
  paymentCard: null,
  freeSpins: { available: 3, nextAt: null },
  luckMeter: { value: 5, max: 30 },
};

/** The spin button carries the batch price: «Крутить 1 000 ₽». */
const SPIN = /^Крутить /;

describe('roulette screen', () => {
  let holder: HolderView;
  const calls: { method: string; path: string; body: unknown }[] = [];

  beforeEach(() => {
    me = baseMe;
    configResponse = config;
    holder = {
      cards: [],
      pending: [],
      slots: { used: 0, total: 5 },
      ownedHolders: ['basic'],
      collection: { score: 0, level: 1, nextLevelScore: 25 },
    };
    calls.length = 0;
    miniGamesEnabled = true;
    useSession.getState().setTokens({ accessToken: 'a', refreshToken: 'r' });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const path = url.replace('/api', '');
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method: init?.method ?? 'GET', path, body });
      const json = (data: unknown) =>
        Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
      if (path === '/v1/me') return json(me);
      if (path === '/v1/config/public') return json(configResponse);
      if (path === '/v1/cards') return json(holder);
      if (path === '/v1/minigames') return json({ enabled: miniGamesEnabled });
      if (path === '/v1/spin') return json(spin);
      if (path === '/v1/cards/card-1/cashout') {
        return json({
          cardId: 'card-1',
          payout: 225_000,
          fee: 25_000,
          wallet: { currency: 'RUB', balance: 625_000 },
        });
      }
      if (path === '/v1/cards/cashout-many') {
        return json({
          cardIds: ['card-1', 'card-2'],
          payout: 450_000,
          fee: 50_000,
          wallet: { currency: 'RUB', balance: 850_000 },
          toCard: null,
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
        <RouletteScreen />
      </QueryClientProvider>,
    );

  it('spins, reveals the server result and cashes out', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: SPIN }));

    // Reduced motion: the ribbon resolves immediately to the card the server decided.
    expect(await screen.findByText('Почти 7777!')).toBeTruthy();
    const spinCall = calls.find((c) => c.path === '/v1/spin');
    expect(spinCall?.body).toMatchObject({
      packId: 'basic',
      payment: { type: 'wallet' },
      count: 1,
    });
    expect((spinCall?.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[\w-]{8,}$/);

    fireEvent.click(screen.getByRole('button', { name: /Забрать деньги 2\s250\s₽/ }));
    expect(await screen.findByRole('button', { name: SPIN })).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/cards/card-1/cashout')).toBe(true);
  });

  it('locks packs above the player level and shows the luck meter', async () => {
    me = { ...baseMe, game: { ...baseMe.game, freeSpins: { available: 0, nextAt: null } } };
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Вид прокрута' }));
    const business = await screen.findByRole('radio', { name: /Бизнес/ });
    expect((business as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('4 / 30')).toBeTruthy();
  });

  it('shows the milestone meter and a gold button when the next spin is lucky', async () => {
    me = {
      ...baseMe,
      game: { ...baseMe.game, luckMeters: [{ packId: 'basic', value: 30, max: 30 }] },
    };
    renderScreen();
    expect(await screen.findByText('10 / 500')).toBeTruthy();
    const button = await screen.findByRole('button', { name: /^Счастливый прокрут 1\s000\s₽$/ });
    expect(button.className).toContain('spin-button--lucky');
  });

  it('marks a batch that reaches the milestone spin as lucky', async () => {
    me = {
      ...baseMe,
      game: { ...baseMe.game, totalSpins: 498, milestone: { value: 498, max: 500 } },
    };
    renderScreen();
    expect(await screen.findByRole('button', { name: SPIN })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сколько раз крутить' }));
    fireEvent.click(screen.getByRole('radio', { name: '×2' }));
    expect(await screen.findByRole('button', { name: /^Счастливый прокрут ×2 / })).toBeTruthy();
    // The count is persisted: put it back.
    fireEvent.click(screen.getByRole('button', { name: 'Сколько раз крутить' }));
    fireEvent.click(screen.getByRole('radio', { name: '×1' }));
  });

  it('reopens an undecided card on launch', async () => {
    holder = { ...holder, pending: [card] };
    renderScreen();
    expect(await screen.findByText('Заберите деньги или оставьте карту себе')).toBeTruthy();
    // The spin row keeps its place (no layout jump) but is inert until the card is decided.
    expect(
      screen.getByRole('button', { name: SPIN, hidden: true }).closest('[inert]'),
    ).not.toBeNull();
  });

  it('cashes out all undecided cards in one request', async () => {
    // The holder keeps listing both cards (a stale refetch): decided cards must not come back.
    holder = { ...holder, pending: [card, { ...card, id: 'card-2', number: '9123456712341111' }] };
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: /^Забрать всё в кошелёк/ }));
    expect(await screen.findByRole('button', { name: SPIN })).toBeTruthy();
    const batch = calls.filter((c) => c.path.startsWith('/v1/cards/') && c.method === 'POST');
    expect(batch).toHaveLength(1);
    expect(batch[0]?.path).toBe('/v1/cards/cashout-many');
    expect(batch[0]?.body).toMatchObject({ cardIds: ['card-1', 'card-2'] });
  });

  it('lights the pack button while free spins wait and takes them in one tap', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: '🎁 Бесплатно: 3' }));
    expect(await screen.findByRole('button', { name: 'Крутить бесплатно' })).toBeTruthy();
    // Back to the paid pack through the sheet (the selection is persisted).
    fireEvent.click(screen.getByRole('button', { name: 'Вид прокрута' }));
    fireEvent.click(screen.getByRole('radio', { name: /Базовый/ }));
    expect(await screen.findByRole('button', { name: /^Крутить 1\s000\s₽$/ })).toBeTruthy();
  });

  it('picks a card in the payment sheet, sorted by luck or balance', async () => {
    const held = { ...card, held: true, expiresAt: '2099-01-01T00:00:00Z' };
    holder = {
      ...holder,
      cards: [
        { ...held, id: 'rich', number: '9123456712341111', balance: 900_000, luckPoints: 10 },
        { ...held, id: 'lucky', number: '9123456712342222', balance: 300_000, luckPoints: 60 },
      ],
    };
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Чем платить' }));
    const order = () =>
      screen
        .getAllByRole('radio', { name: /^Карта •/ })
        .map((b) => b.getAttribute('aria-label') ?? '');
    expect(order()).toEqual(['Карта •••• 2222', 'Карта •••• 1111']);
    fireEvent.click(screen.getByRole('radio', { name: 'По балансу' }));
    expect(order()).toEqual(['Карта •••• 1111', 'Карта •••• 2222']);
    fireEvent.click(screen.getByRole('radio', { name: 'Картами' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Карта •••• 2222' }));
    expect(await screen.findByText('•••• 2222')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SPIN }));
    await screen.findByText('Почти 7777!');
    expect(calls.find((c) => c.path === '/v1/spin')?.body).toMatchObject({
      payment: { type: 'card', cardId: 'lucky' },
    });
  });

  it('shows the invite banner only after 200 spins', async () => {
    configResponse = {
      ...config,
      botUsername: 'spin_bot',
      referral: {
        referrerReward: { RUB: 3_000_000, USD: 0 },
        referredReward: { RUB: 1_000_000, USD: 0 },
        commission: { shareBp: 1000 },
      },
    } as unknown as PublicConfigResponse;
    me = { ...baseMe, game: { ...baseMe.game, totalSpins: 199 } };
    const first = renderScreen();
    await screen.findByRole('button', { name: SPIN });
    expect(screen.queryByText('Позови друга')).toBeNull();
    first.unmount();

    me = { ...baseMe, game: { ...baseMe.game, totalSpins: 200 } };
    renderScreen();
    expect(await screen.findByText('Позови друга')).toBeTruthy();
  });

  it('offers a wallet top-up instead of spinning when only the cards can pay (D-166)', async () => {
    me = {
      ...baseMe,
      wallets: [
        { currency: 'RUB', balance: 50_000 },
        { currency: 'USD', balance: 0 },
      ],
    };
    holder = {
      ...holder,
      cards: [{ ...card, held: true, expiresAt: '2099-01-01T00:00:00Z', balance: 900_000 }],
    };
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: SPIN }));
    expect(useWalletPrompt.getState().request).toEqual({ currency: 'RUB', price: 100_000 });
    expect(calls.some((c) => c.path === '/v1/spin')).toBe(false);
    useWalletPrompt.getState().close();
  });

  it('opens the mini-game tiles from «Игры», or says they are coming while the flag is off', async () => {
    const first = renderScreen();
    // Tapped before /v1/minigames answers: still the tiles, not the «soon» toast.
    fireEvent.click(await screen.findByRole('button', { name: /Игры/ }));
    // D-177: straight to the mini-games screen.
    expect(useNavigation.getState().stack.at(-1)).toEqual({ name: 'minigames' });
    first.unmount();

    useNavigation.getState().setTab('game');
    miniGamesEnabled = false;
    renderScreen();
    const soon = await screen.findByRole('button', { name: /Игры/ });
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === '/v1/minigames')).toBe(true);
    });
    fireEvent.click(soon);
    expect(useNavigation.getState().tab).toBe('game');
    expect(useNavigation.getState().stack).toEqual([]);
    expect(JSON.stringify(useToast.getState())).toContain('Мини-игры скоро появятся');
  });
});
