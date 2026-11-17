import {
  type AlbumResponse,
  type LeaderboardResponse,
  type PublicConfigResponse,
  type SeasonCollectionResponse,
  seasonCardDesign,
  type SpinResponse,
  type TrophyResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeasonService } from '../src/game-config/season.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { createTestApp, fund, get, login, post, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('album of trophies (D-129) and season collection (D-130)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('keeps a chosen card forever: balance to the wallet, slot paid, out of the game', async () => {
    const session = await login(t);
    await fund(t, session.userId, 'RUB', 100_000_000n);
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const card = spin.body.spins[0]!.card;
    const before = await t.prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: session.userId, currency: 'RUB' } },
    });

    const res = await post<TrophyResponse>(t, session, `/v1/cards/${card.id}/trophy`);
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(card.trophyPrice);
    expect(res.body.payout).toBe(card.cashoutValue);
    expect(res.body.wallet.balance).toBe(
      Number(before.balance) + card.cashoutValue - card.trophyPrice,
    );
    const row = await t.prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row).toMatchObject({ status: 'trophy', balance: 0n, ownerId: session.userId });

    const album = await get<AlbumResponse>(t, session, '/v1/album');
    expect(album.slots).toMatchObject({ used: 1, total: 5, free: 5 });
    expect(album.trophies.map((c) => c.id)).toEqual([card.id]);
    // A trophy is not a playable card any more.
    expect((await post<ErrorBody>(t, session, `/v1/cards/${card.id}/hold`)).status).toBe(404);

    const board = await get<LeaderboardResponse>(t, session, '/v1/leaderboard?type=album');
    expect(board.me?.score).toBe(card.rarityScore);
    const profile = await get<{ trophies: { id: string }[] }>(
      t,
      session,
      `/v1/players/${session.userId}`,
    );
    expect(profile.trophies.map((c) => c.id)).toEqual([card.id]);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('freezes the card design in the album (D-168)', async () => {
    const session = await login(t);
    await fund(t, session.userId, 'RUB', 100_000_000n);
    const season = await t.app.get(SeasonService).current();
    const current = seasonCardDesign(season.designSetId);
    const config = await get<PublicConfigResponse>(t, session, '/v1/config/public');
    expect(config.cardDesign).toBe(current);

    const drops: string[] = [];
    for (let i = 0; i < 2; i++) {
      const spin = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      // A card in play follows the season's design.
      expect(spin.body.spins[0]!.card.design).toBeNull();
      const id = spin.body.spins[0]!.card.id;
      drops.push(id);
      const kept = await post<TrophyResponse>(t, session, `/v1/cards/${id}/trophy`);
      expect(kept.body.card.design).toBe(current);
    }
    expect(await t.prisma.card.findUniqueOrThrow({ where: { id: drops[0]! } })).toMatchObject({
      design: current,
    });

    // A trophy kept before designs existed has none stored: it shows the original look.
    await t.prisma.card.update({ where: { id: drops[1]! }, data: { design: null } });
    const album = await get<AlbumResponse>(t, session, '/v1/album');
    const designs = Object.fromEntries(album.trophies.map((c) => [c.id, c.design]));
    expect(designs).toEqual({ [drops[0]!]: current, [drops[1]!]: 'classic' });
  });

  it('refuses a card when every slot is taken', async () => {
    const session = await login(t);
    await fund(t, session.userId, 'RUB', 100_000_000n);
    const drops: string[] = [];
    for (let i = 0; i < 6; i++) {
      const spin = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      const id = spin.body.spins[0]!.card.id;
      drops.push(id);
      if (i < 5) expect((await post(t, session, `/v1/cards/${id}/trophy`)).status).toBe(200);
    }
    const full = await post<ErrorBody>(t, session, `/v1/cards/${drops[5]!}/trophy`);
    expect(full.body.error.code).toBe('ALBUM_FULL');

    // D-139: removing a trophy frees its slot; the card is gone for good.
    const key = 'remove-trophy-key-1';
    const removed = await post(t, session, `/v1/cards/${drops[0]!}/trophy/remove`, {
      idempotencyKey: key,
    });
    expect(removed).toMatchObject({ status: 200, body: { cardId: drops[0] } });
    const replay = await post(t, session, `/v1/cards/${drops[0]!}/trophy/remove`, {
      idempotencyKey: key,
    });
    expect(replay.body).toEqual(removed.body);
    const again = await post<ErrorBody>(t, session, `/v1/cards/${drops[0]!}/trophy/remove`);
    expect(again.body.error.code).toBe('CARD_NOT_FOUND');
    expect(await t.prisma.card.findUniqueOrThrow({ where: { id: drops[0]! } })).toMatchObject({
      status: 'cashed',
      ownerId: null,
    });
    expect((await post(t, session, `/v1/cards/${drops[5]!}/trophy`)).status).toBe(200);

    // Only trophies can be removed, and only by their owner.
    const other = await login(t);
    const stranger = await post<ErrorBody>(t, other, `/v1/cards/${drops[1]!}/trophy/remove`);
    expect(stranger.body.error.code).toBe('CARD_NOT_FOUND');
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('shows which bank and tier of the season the player has dropped', async () => {
    const session = await login(t);
    const empty = await get<SeasonCollectionResponse>(t, session, '/v1/season/collection');
    expect(empty.collected).toBe(0);
    expect(empty.total).toBe(empty.banks.length * 5);
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const card = spin.body.spins[0]!.card;
    await post(t, session, `/v1/cards/${card.id}/cashout`);
    const after = await get<SeasonCollectionResponse>(t, session, '/v1/season/collection');
    expect(after.collected).toBe(1);
    expect(after.banks.find((b) => b.id === card.bankId)?.tiers[card.tier]).toMatchObject({
      number: card.number,
    });
  });
});
