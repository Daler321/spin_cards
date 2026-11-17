import type { LeaderboardEntry, LeaderboardResponse } from '@spincards/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RatingScreen from '../src/screens/RatingScreen';
import { useSession } from '../src/state/session';

let ids = 0;
const entry = (rank: number, firstName: string, score: number): LeaderboardEntry => ({
  userId: `u${String(++ids)}`,
  rank,
  firstName,
  photoUrl: null,
  level: 1,
  score,
  isMe: false,
  medals: [],
});

// Ties share a rank, and players may share a first name: rows must not rely on those for identity.
const boards: Record<string, LeaderboardResponse> = {
  balance: {
    type: 'balance',
    top: [entry(1, 'Dev', 100_000), entry(2, 'Dev', 0), entry(2, 'Dev', 0), entry(2, 'Dev', 0)],
    me: null,
  },
  collection: { type: 'collection', top: [entry(1, 'Ruby', 40)], me: null },
  album: { type: 'album', top: [entry(1, 'Alba', 80)], me: null },
  season: {
    type: 'season',
    top: [entry(1, 'Sezon', 120)],
    me: null,
    season: {
      name: 'Сезон 1',
      endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      medals: [{ maxRank: 1, icon: '🥇', achievementId: 'season_top1' }],
      carryover: { perPoint: { RUB: 1000, USD: 11 }, cap: { RUB: 20_000_000, USD: 220_000 } },
    },
  },
};

describe('rating screen', () => {
  beforeEach(() => {
    useSession.getState().setTokens({ accessToken: 'a', refreshToken: 'r' });
    vi.stubGlobal('fetch', (url: string) => {
      const json = (data: unknown) =>
        Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
      if (url.includes('/v1/leaderboard')) {
        const type = new URL(url, 'http://x').searchParams.get('type') ?? 'season';
        return json(boards[type]);
      }
      if (url.endsWith('/v1/me')) return json({ settings: { hideFromLeaderboard: false } });
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('switching tabs never leaves rows of the other board (tied ranks, same names)', async () => {
    const errors = vi.spyOn(console, 'error');
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RatingScreen />
      </QueryClientProvider>,
    );
    // D-125: the season rating opens first, with its end and rewards.
    expect(await screen.findByText('Sezon')).toBeTruthy();
    expect(screen.getByText('Сезон 1')).toBeTruthy();
    // Balance and collection reset with the season, so they are season boards.
    fireEvent.click(screen.getByRole('radio', { name: 'Баланс' }));
    await waitFor(() => {
      expect(document.querySelectorAll('.leaderboard li')).toHaveLength(4);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Коллекция' }));
    await screen.findByText('Ruby');
    expect(document.querySelectorAll('.leaderboard li')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Баланс' }));
    await waitFor(() => {
      expect(document.querySelectorAll('.leaderboard li')).toHaveLength(4);
    });
    expect(screen.queryByText('Ruby')).toBeNull();
    // Duplicate keys make React keep stale rows around on later updates.
    // All time: the album only.
    fireEvent.click(screen.getByRole('radio', { name: 'Всё время' }));
    await screen.findByText('Alba');
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });
});
