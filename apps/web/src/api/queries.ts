import type {
  SeasonsResponse,
  AlbumIncomeClaimResponse,
  CollectResponse,
  CraftResponse,
  NickBonusClaimResponse,
  StarsInvoiceResponse,
  AchievementsResponse,
  AlbumResponse,
  P2pRecipient,
  P2pSendRequest,
  P2pSendResponse,
  SeasonCollectionResponse,
  TrophyRemoveResponse,
  TrophyResponse,
  BatchCashoutResponse,
  BuyHolderResponse,
  CardActionResponse,
  CashoutResponse,
  ChestClaimResponse,
  ChestUpgradeResponse,
  ConvertResponse,
  Currency,
  DailyClaimResponse,
  HistoryFilter,
  QuestClaimResponse,
  QuestsResponse,
  HistoryItem,
  HolderView,
  LeaderboardResponse,
  LeaderboardType,
  PlayerProfileResponse,
  SubscriptionStatus,
  ShareImageResponse,
  SharePrepareResponse,
  MeResponse,
  ProfileStats,
  PublicConfigResponse,
  ReferralsResponse,
  Region,
  SettingsRequest,
  ShopBuyResponse,
  SpinPaymentRequest,
  SpinResponse,
  TransferEndpoint,
  TransferResponse,
  WheelSpinResponse,
  ChannelQuestClaimResponse,
  BlackjackActRequest,
  BlackjackResponse,
  BlackjackStartRequest,
  CoinflipRequest,
  CoinflipResponse,
  MiniGameRoundRequest,
  MiniGamesInfo,
  MinesOpenRequest,
  MinesResponse,
  MinesStartRequest,
  PlinkoRequest,
  PlinkoResponse,
} from '@spincards/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { openInvoice } from '../app/telegram';
import { api, newIdempotencyKey } from './client';

export const keys = { me: ['me'], cards: ['cards'], config: ['config'] } as const;

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<MeResponse>('/v1/me') });
export const useHolder = () =>
  useQuery({ queryKey: keys.cards, queryFn: () => api<HolderView>('/v1/cards') });
export const usePublicConfig = () =>
  useQuery({
    queryKey: keys.config,
    queryFn: () => api<PublicConfigResponse>('/v1/config/public', { auth: false }),
    staleTime: 60_000,
  });

/**
 * Mutations carry an idempotency key created once per user action, so network retries of the same
 * action never charge twice. Balances come only from server responses (no optimistic updates).
 */
function mutation<TArgs, TResult>(
  path: (args: TArgs) => string,
  body: (args: TArgs) => object = () => ({}),
) {
  return (args: TArgs) =>
    api<TResult>(path(args), {
      method: 'POST',
      body: { ...body(args), idempotencyKey: newIdempotencyKey() },
      retryOnNetworkError: true,
    });
}

export function useSpin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<
      { packId: string; payment: SpinPaymentRequest; count: number },
      SpinResponse
    >(
      () => '/v1/spin',
      (args) => args,
    ),
    onSuccess: (result) => {
      client.setQueryData<MeResponse>(
        keys.me,
        (me) =>
          me && {
            ...me,
            wallets: result.wallets,
            level: result.exp.level,
            exp: result.exp.total,
            game: {
              ...me.game,
              freeSpins: result.freeSpins,
              pendingCardId: result.spins[0]?.card.id ?? null,
              guaranteedFloor: null,
            },
          },
      );
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: keys.cards });
    },
  });
}

export function useCashout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<{ cardId: string; toCardId?: string }, CashoutResponse>(
      (a) => `/v1/cards/${a.cardId}/cashout`,
      (a) => (a.toCardId ? { toCardId: a.toCardId } : {}),
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: keys.cards });
    },
  });
}

export function useHold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<string, CardActionResponse>((cardId) => `/v1/cards/${cardId}/hold`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: keys.cards });
    },
  });
}

export function useRegion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (region: Region) =>
      api<MeResponse>('/v1/me/region', { method: 'POST', body: { region } }),
    onSuccess: (me) => {
      client.setQueryData(keys.me, me);
    },
  });
}

export function useDailyClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<undefined, DailyClaimResponse>(() => '/v1/bonus/daily/claim'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });
}

// ─── M5: holder, wallet, bonuses, social ────────────────────────────────────

export const moreKeys = {
  quests: ['quests'],
  stats: ['stats'],
  referrals: ['referrals'],
  leaderboard: (type: LeaderboardType) => ['leaderboard', type],
  history: ['history'],
} as const;

export const useStats = () =>
  useQuery({ queryKey: moreKeys.stats, queryFn: () => api<ProfileStats>('/v1/me/stats') });
export const useReferrals = () =>
  useQuery({
    queryKey: moreKeys.referrals,
    queryFn: () => api<ReferralsResponse>('/v1/referrals'),
  });
export const subscriptionKey = ['subscription'] as const;

/** Required channels (D-110); refetched when an API call answers SUBSCRIPTION_REQUIRED. */
export const useSubscription = () =>
  useQuery({
    queryKey: subscriptionKey,
    queryFn: () => api<SubscriptionStatus>('/v1/subscription'),
    staleTime: 60_000,
  });

export function useSubscriptionCheck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<SubscriptionStatus>('/v1/subscription/check', { method: 'POST' }),
    onSuccess: (status) => {
      client.setQueryData(subscriptionKey, status);
      if (status.ok) void client.invalidateQueries();
    },
  });
}

/** D-177: a public profile by @username (null: nothing asked yet). */
export const usePlayerByUsername = (username: string | null) =>
  useQuery({
    queryKey: ['player', 'username', username],
    queryFn: () =>
      api<PlayerProfileResponse>(`/v1/players/by-username/${encodeURIComponent(username ?? '')}`),
    enabled: username !== null,
    retry: false,
  });

export const useSeasons = () =>
  useQuery({ queryKey: ['seasons'], queryFn: () => api<SeasonsResponse>('/v1/seasons') });

export const usePlayer = (userId: string | null) =>
  useQuery({
    queryKey: ['player', userId],
    queryFn: () => api<PlayerProfileResponse>(`/v1/players/${userId ?? ''}`),
    enabled: userId !== null,
  });

export const useLeaderboard = (type: LeaderboardType) =>
  useQuery({
    queryKey: moreKeys.leaderboard(type),
    queryFn: () => api<LeaderboardResponse>(`/v1/leaderboard?type=${type}`),
    // Fresh every time the tab opens: ranks move with every spin.
    staleTime: 0,
    refetchOnMount: 'always',
  });

export const useHistory = (filter: HistoryFilter = {}) =>
  useInfiniteQuery({
    // Prefix of moreKeys.history: invalidating the history refetches every filter.
    queryKey: [...moreKeys.history, filter],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      if (filter.group) params.set('group', filter.group);
      if (filter.currency) params.set('currency', filter.currency);
      if (filter.days) params.set('days', String(filter.days));
      return api<{ items: HistoryItem[]; nextCursor: string | null }>(
        `/v1/wallet/history?${params.toString()}`,
      );
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** After any money move: balances, holder and history are refetched from the server. */
function useRefreshAll() {
  const client = useQueryClient();
  return () => {
    for (const key of [keys.me, keys.cards, moreKeys.history, moreKeys.stats]) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
}

export function useCardAction(action: 'extend' | 'restore') {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<string, CardActionResponse>((cardId) => `/v1/cards/${cardId}/${action}`),
    onSuccess: refresh,
  });
}

export function useTopup() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ cardId: string; amount: number }, CardActionResponse>(
      (a) => `/v1/cards/${a.cardId}/topup`,
      (a) => ({ amount: a.amount }),
    ),
    onSuccess: refresh,
  });
}

export function useConvert() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ from: Currency; to: Currency; amount: number }, ConvertResponse>(
      () => '/v1/wallet/convert',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

export function useBuyHolder() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ holderId: string; payWith: Currency }, BuyHolderResponse>(
      () => '/v1/holders/buy',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

export function useShopBuy() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ itemId: string; currency: Currency; packId?: string }, ShopBuyResponse>(
      () => '/v1/shop/buy',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

export function useChestUpgrade() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ currency: Currency }, ChestUpgradeResponse>(
      () => '/v1/bonus/chest/upgrade',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

/** The wheel animation runs first; balances refresh when it settles (see BonusesScreen). */
export function useWheelSpin() {
  return useMutation({
    mutationFn: mutation<undefined, WheelSpinResponse>(() => '/v1/bonus/wheel/spin'),
  });
}

export function useRefreshBalances() {
  return useRefreshAll();
}

export function useChestClaim() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<undefined, ChestClaimResponse>(() => '/v1/bonus/chest/claim'),
    onSuccess: refresh,
  });
}

export function useSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: SettingsRequest) =>
      api<undefined>('/v1/settings', { method: 'POST', body: settings }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}

// ─── Batch decisions and transfers ─────────────────────────────────────────

export function useCashoutMany() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ cardIds: string[]; toCardId?: string }, BatchCashoutResponse>(
      () => '/v1/cards/cashout-many',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

export function useHoldMany() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ cardIds: string[] }, { cardIds: string[] }>(
      () => '/v1/cards/hold-many',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

export function useTransfer() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<
      { from: TransferEndpoint; to: TransferEndpoint; amount: number },
      TransferResponse
    >(
      () => '/v1/transfers',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

/** D-174: every other held card of the currency to one card or the wallet. */
export function useCollect() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ currency: Currency; to: TransferEndpoint }, CollectResponse>(
      () => '/v1/transfers/collect',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

/** D-170: the server rolls the chance; the client only shows the answer. */
export function useCraft() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<{ cardIds: string[] }, CraftResponse>(
      () => '/v1/cards/craft',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

export function useAlbumIncomeClaim() {
  const client = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<undefined, AlbumIncomeClaimResponse>(() => '/v1/bonus/album/claim'),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: ['album'] });
    },
  });
}

export function useNickBonusClaim() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<undefined, NickBonusClaimResponse>(() => '/v1/bonus/nick/claim'),
    onSuccess: refresh,
  });
}

/** Uploads a rendered card image for sharing or saving (D-114). */
export const shareImage = (cardId: string, image: string) =>
  api<ShareImageResponse>('/v1/share/images', { method: 'POST', body: { cardId, image } });

export const prepareShare = (token: string, text: string, link: string, linkText: string) =>
  api<SharePrepareResponse>('/v1/share/prepare', {
    method: 'POST',
    body: { token, text, ...(link && { link, linkText }) },
  });

export const useQuests = () =>
  useQuery({
    queryKey: moreKeys.quests,
    queryFn: () => api<QuestsResponse>('/v1/quests'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

export function useQuestClaim() {
  const refresh = useRefreshAll();
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<string, QuestClaimResponse>((id) => `/v1/quests/${id}/claim`),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: moreKeys.quests });
    },
  });
}

/** D-157: the "join the channel" quest; the server asks Telegram. */
export function useChannelQuestClaim() {
  const refresh = useRefreshAll();
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<undefined, ChannelQuestClaimResponse>(() => '/v1/quests/channel/claim'),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: moreKeys.quests });
    },
  });
}

/** D-158: one step of the "invite friends" quest. */
export function useInviteQuestClaim() {
  const refresh = useRefreshAll();
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<number, ChannelQuestClaimResponse>(
      () => '/v1/quests/invite/claim',
      (friends) => ({ friends }),
    ),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: moreKeys.quests });
    },
  });
}

export const useAlbum = () =>
  useQuery({
    queryKey: ['album'],
    queryFn: () => api<AlbumResponse>('/v1/album'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

export function useTrophy() {
  const refresh = useRefreshAll();
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<string, TrophyResponse>((cardId) => `/v1/cards/${cardId}/trophy`),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: ['album'] });
    },
  });
}

/** D-139: removes a trophy from the album for good. */
export function useRemoveTrophy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutation<string, TrophyRemoveResponse>(
      (cardId) => `/v1/cards/${cardId}/trophy/remove`,
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['album'] });
      void client.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}

export const useSeasonCollection = () =>
  useQuery({
    queryKey: ['season-collection'],
    queryFn: () => api<SeasonCollectionResponse>('/v1/season/collection'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

export function useP2pSend() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: mutation<Omit<P2pSendRequest, 'idempotencyKey'>, P2pSendResponse>(
      () => '/v1/wallet/send',
      (a) => a,
    ),
    onSuccess: refresh,
  });
}

/** The player behind a @username (null until asked). */
export const useRecipient = (username: string | null) =>
  useQuery({
    queryKey: ['recipient', username],
    queryFn: () =>
      api<P2pRecipient>(`/v1/wallet/recipient?username=${encodeURIComponent(username ?? '')}`),
    enabled: username !== null,
    retry: false,
  });

export const useAchievements = () =>
  useQuery({
    queryKey: ['achievements'],
    queryFn: () => api<AchievementsResponse>('/v1/achievements'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

/**
 * D-146: buys a Stars product: the api makes the invoice, Telegram takes the payment, the bot
 * reports it and the api credits it. The game data is refreshed once the credit has had time to
 * land (it arrives through the bot, a moment after Telegram says "paid").
 */
export function useStarsPurchase() {
  const refresh = useRefreshAll();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, cardId }: { productId: string; cardId?: string }) => {
      const invoice = await api<StarsInvoiceResponse>('/v1/payments/stars/invoice', {
        method: 'POST',
        body: { productId, ...(cardId && { cardId }), idempotencyKey: newIdempotencyKey() },
      });
      return openInvoice(invoice.invoiceLink);
    },
    onSuccess: (status) => {
      if (status !== 'paid') return;
      const again = () => {
        refresh();
        void client.invalidateQueries({ queryKey: ['album'] });
      };
      setTimeout(again, 1500);
      setTimeout(again, 5000);
    },
  });
}

// ─── Mini-games (D-169) ─────────────────────────────────────────────────────

const miniGamesKey = ['minigames'] as const;

export const useMiniGames = () =>
  useQuery({ queryKey: miniGamesKey, queryFn: () => api<MiniGamesInfo>('/v1/minigames') });

/** Balances and bet limits after a round; screens call it once the animation has shown the result. */
export function useMiniGamesRefresh() {
  const client = useQueryClient();
  const refresh = useRefreshAll();
  return () => {
    refresh();
    void client.invalidateQueries({ queryKey: miniGamesKey });
  };
}

type Body<T> = Omit<T, 'idempotencyKey'>;
const miniGamePath = (path: string) => () => `/v1/minigames/${path}`;
const asBody = (args: object): object => args;

export const useMinesStart = () =>
  useMutation({
    mutationFn: mutation<Body<MinesStartRequest>, MinesResponse>(
      miniGamePath('mines/start'),
      asBody,
    ),
  });
export const useMinesOpen = () =>
  useMutation({
    mutationFn: mutation<Body<MinesOpenRequest>, MinesResponse>(miniGamePath('mines/open'), asBody),
  });
export const useMinesCashout = () =>
  useMutation({
    mutationFn: mutation<Body<MiniGameRoundRequest>, MinesResponse>(
      miniGamePath('mines/cashout'),
      asBody,
    ),
  });
export const usePlinko = () =>
  useMutation({
    mutationFn: mutation<Body<PlinkoRequest>, PlinkoResponse>(miniGamePath('plinko'), asBody),
  });
export const useCoinflip = () =>
  useMutation({
    mutationFn: mutation<Body<CoinflipRequest>, CoinflipResponse>(miniGamePath('coinflip'), asBody),
  });
export const useBlackjackStart = () =>
  useMutation({
    mutationFn: mutation<Body<BlackjackStartRequest>, BlackjackResponse>(
      miniGamePath('blackjack/start'),
      asBody,
    ),
  });
export const useBlackjackAct = () =>
  useMutation({
    mutationFn: mutation<Body<BlackjackActRequest>, BlackjackResponse>(
      miniGamePath('blackjack/act'),
      asBody,
    ),
  });
