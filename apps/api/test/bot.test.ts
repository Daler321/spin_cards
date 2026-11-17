import type {
  BotChannelPostResponse,
  BotStartResponse,
  ClaimNotificationsResponse,
  PreCheckoutResponse,
  StarsInvoiceResponse,
  SuccessfulPaymentResponse,
} from '@spincards/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BroadcastService, queueChannelPost } from '../src/notifications/broadcast.service.js';
import { SubscriptionService } from '../src/subscription/subscription.service.js';
import { TextsService } from '../src/texts/texts.service.js';
import { NotificationScannerService } from '../src/notifications/notification-scanner.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import {
  deliveryTime,
  isQuietHour,
  localDayStart,
  retryDelayMs,
} from '../src/notifications/schedule.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  login,
  nextTelegramId,
  patchConfig,
  patchFlags,
  post,
  type TestApp,
} from './support/app.js';
import { TEST_INTERNAL_TOKEN } from './support/env.js';

type ErrorBody = { error: { code: string } };

describe('notification schedule', () => {
  it('keeps quiet hours in local time, wrapping midnight', () => {
    expect(isQuietHour(23, 23, 9)).toBe(true);
    expect(isQuietHour(3, 23, 9)).toBe(true);
    expect(isQuietHour(9, 23, 9)).toBe(false);
    expect(isQuietHour(12, 23, 9)).toBe(false);
    expect(isQuietHour(12, 9, 9)).toBe(false);
  });

  it('moves a message due at night to 09:00 local time', () => {
    // 23:30 in Moscow (UTC+3) = 20:30 UTC -> 09:00 Moscow = 06:00 UTC next day.
    const night = new Date('2026-10-13T20:30:15.500Z');
    expect(deliveryTime(night, 'Europe/Moscow', 23, 9).toISOString()).toBe(
      '2026-10-14T06:00:00.000Z',
    );
    const noon = new Date('2026-10-13T09:00:00Z');
    expect(deliveryTime(noon, 'Europe/Moscow', 23, 9)).toBe(noon);
    expect(localDayStart(noon, 'Europe/Moscow').toISOString()).toBe('2026-10-12T21:00:00.000Z');
  });

  it('backs off between attempts and honours retry_after', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(2, 7)).toBe(7000);
  });
});

describe('bot internal API', () => {
  let t: TestApp;
  const internal = { 'x-internal-token': TEST_INTERNAL_TOKEN };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const call = async <T>(url: string, payload: unknown, headers = internal) => {
    const res = await t.app.inject({ method: 'POST', url, headers, payload: payload as object });
    return { status: res.statusCode, body: res.body ? res.json<T>() : (undefined as T) };
  };
  const botUser = (telegramId = nextTelegramId()) => ({
    telegramId: String(telegramId),
    firstName: 'Бот',
    languageCode: 'ru',
  });
  const userOf = (telegramId: string) =>
    t.prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });

  /** Quiet window around the current Moscow hour, or none. */
  const quietNow = (quiet: boolean) => {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    return quiet
      ? { quietStartHour: hour, quietEndHour: (hour + 2) % 24 }
      : { quietStartHour: (hour + 2) % 24, quietEndHour: (hour + 3) % 24 };
  };

  describe('guard', () => {
    it('needs the internal token', async () => {
      const payload = { user: botUser() };
      expect((await call('/internal/bot/start', payload, {} as typeof internal)).status).toBe(401);
      expect(
        (await call('/internal/bot/start', payload, { 'x-internal-token': 'wrong' })).status,
      ).toBe(401);
      expect((await call('/internal/bot/start', payload)).status).toBe(200);
    });
  });

  describe('/start, settings and blocks', () => {
    it('signs up with a referral payload once, then unblocks on /start', async () => {
      const referrer = await login(t);
      const { referralCode } = await userOf(
        (
          await t.prisma.user.findUniqueOrThrow({ where: { id: referrer.userId } })
        ).telegramId.toString(),
      );
      const user = botUser();
      const first = await call<BotStartResponse>('/internal/bot/start', {
        user,
        payload: `ref_${referralCode}`,
      });
      expect(first.body).toEqual({
        isNew: true,
        notificationsEnabled: true,
        referralCode: expect.any(String) as string,
      });
      const created = await userOf(user.telegramId);
      expect(created.referrerId).toBe(referrer.userId);
      expect(
        (await t.prisma.wallet.findMany({ where: { userId: created.id } })).length,
      ).toBeGreaterThan(0);

      expect(
        (await call('/internal/bot/chat-status', { telegramId: user.telegramId, blocked: true }))
          .status,
      ).toBe(204);
      expect((await userOf(user.telegramId)).botBlockedAt).not.toBeNull();

      const again = await call<BotStartResponse>('/internal/bot/start', { user });
      expect(again.body.isNew).toBe(false);
      expect((await userOf(user.telegramId)).botBlockedAt).toBeNull();

      await call('/internal/bot/settings', {
        telegramId: user.telegramId,
        notificationsEnabled: false,
      });
      expect((await userOf(user.telegramId)).notificationsEnabled).toBe(false);
    });
  });

  describe('notifications', () => {
    const scanner = () => t.app.get(NotificationScannerService);
    const service = () => t.app.get(NotificationsService);
    const claimMine = async (userId: string) => {
      const res = await call<ClaimNotificationsResponse>('/internal/bot/notifications/claim', {
        limit: 100,
      });
      const mine = await t.prisma.notificationOutbox.findMany({ where: { userId } });
      const ids = new Set(mine.map((m) => m.id));
      return { ...res.body, items: res.body.items.filter((i) => ids.has(i.id)) };
    };

    it('warns about a held card burning soon, once, and sends it outside quiet hours', async () => {
      await patchConfig(t, (c) => Object.assign(c.notifications, quietNow(false)));
      const session = await login(t);
      const spin = await post<{ spins: { card: { id: string; number: string } }[] }>(
        t,
        session,
        '/v1/spin',
        { packId: 'basic', payment: { type: 'wallet' } },
      );
      const card = spin.body.spins[0]!.card;
      await post(t, session, `/v1/cards/${card.id}/hold`);
      await t.prisma.card.update({
        where: { id: card.id },
        data: { expiresAt: new Date(Date.now() + 2.5 * 3_600_000) },
      });

      await scanner().run();
      await scanner().run();
      const rows = await t.prisma.notificationOutbox.findMany({
        where: { userId: session.userId, kind: 'card_expiring' },
      });
      expect(rows).toHaveLength(1);

      const claimed = await claimMine(session.userId);
      expect(claimed.perSecond).toBe(25);
      expect(claimed.items).toHaveLength(1);
      expect(claimed.items[0]).toMatchObject({
        kind: 'card_expiring',
        languageCode: 'ru',
        params: { last4: card.number.slice(-4), hours: 3 },
      });
      // Leased: a second claim does not hand it out again.
      expect((await claimMine(session.userId)).items).toHaveLength(0);

      const id = claimed.items[0]!.id;
      expect(
        (await call(`/internal/bot/notifications/${id}/result`, { outcome: 'sent' })).status,
      ).toBe(204);
      expect(await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'sent',
        attempts: 1,
      });
    });

    it('holds messages during quiet hours and skips them when turned off or stale', async () => {
      const session = await login(t);
      const enqueue = (kind: 'comeback' | 'free_spin_ready', key = randomUUID()) =>
        service().enqueue([{ userId: session.userId, kind, dedupeKey: `test:${key}` }]);
      await t.prisma.user.update({
        where: { id: session.userId },
        data: { lastSeenAt: new Date(Date.now() - 100 * 3_600_000) },
      });
      await enqueue('comeback');

      await patchConfig(t, (c) => Object.assign(c.notifications, quietNow(true)));
      expect((await claimMine(session.userId)).items).toHaveLength(0);
      const held = await t.prisma.notificationOutbox.findFirstOrThrow({
        where: { userId: session.userId },
      });
      expect(held.status).toBe('pending');
      expect(held.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 3_600_000);

      // Due now, but the player came back in the meantime: stale.
      await t.prisma.notificationOutbox.update({
        where: { id: held.id },
        data: { scheduledAt: new Date() },
      });
      await t.prisma.user.update({
        where: { id: session.userId },
        data: { lastSeenAt: new Date() },
      });
      await patchConfig(t, (c) => Object.assign(c.notifications, quietNow(false)));
      expect((await claimMine(session.userId)).items).toHaveLength(0);
      expect(
        await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: held.id } }),
      ).toMatchObject({ status: 'skipped', lastError: 'player_returned' });

      await t.prisma.user.update({
        where: { id: session.userId },
        data: { notificationsEnabled: false, lastSeenAt: new Date(0) },
      });
      await enqueue('free_spin_ready');
      expect((await claimMine(session.userId)).items).toHaveLength(0);
      expect(
        await t.prisma.notificationOutbox.count({
          where: { userId: session.userId, lastError: 'disabled' },
        }),
      ).toBe(1);
    });

    it('claims only the requested kinds', async () => {
      await patchConfig(t, (c) => Object.assign(c.notifications, quietNow(false)));
      const session = await login(t);
      await t.prisma.user.update({
        where: { id: session.userId },
        data: { lastSeenAt: new Date(0) },
      });
      await service().enqueue([
        { userId: session.userId, kind: 'comeback', dedupeKey: `test:${randomUUID()}` },
      ]);
      const onlyBroadcasts = await call<ClaimNotificationsResponse>(
        '/internal/bot/notifications/claim',
        {
          limit: 100,
          kinds: ['broadcast'],
        },
      );
      const mine = await t.prisma.notificationOutbox.findMany({
        where: { userId: session.userId },
      });
      expect(onlyBroadcasts.body.items.some((i) => mine.some((m) => m.id === i.id))).toBe(false);
      expect(mine[0]).toMatchObject({ status: 'pending', attempts: 0 });
      expect((await claimMine(session.userId)).items.map((i) => i.kind)).toEqual(['comeback']);
    });

    it('caps game messages per day, retries failures and stops on a block', async () => {
      await patchConfig(t, (c) => {
        Object.assign(c.notifications, quietNow(false), { dailyLimit: 1, maxAttempts: 2 });
      });
      const session = await login(t);
      await t.prisma.user.update({
        where: { id: session.userId },
        data: { lastSeenAt: new Date(0) },
      });
      await service().enqueue([
        { userId: session.userId, kind: 'comeback', dedupeKey: `test:${randomUUID()}` },
        { userId: session.userId, kind: 'free_spin_ready', dedupeKey: `test:${randomUUID()}` },
      ]);
      const first = await claimMine(session.userId);
      expect(first.items).toHaveLength(1);
      const id = first.items[0]!.id;

      // Telegram failed: retried later, then given up after maxAttempts.
      await call(`/internal/bot/notifications/${id}/result`, {
        outcome: 'failed',
        error: 'Too Many Requests',
        retryAfterSec: 0,
      });
      expect(await t.prisma.notificationOutbox.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'pending',
        lastError: 'Too Many Requests',
      });
      const retry = await claimMine(session.userId);
      expect(retry.items.map((i) => i.id)).toEqual([id]);
      await call(`/internal/bot/notifications/${id}/result`, { outcome: 'sent' });

      // Daily cap reached: the other game message is dropped.
      expect((await claimMine(session.userId)).items).toHaveLength(0);
      expect(
        await t.prisma.notificationOutbox.count({
          where: { userId: session.userId, lastError: 'daily_limit' },
        }),
      ).toBe(1);

      // A broadcast is not capped, but a block stops everything.
      const { id: broadcastId } = await t.app.get(BroadcastService).create({
        text: 'Новый сезон!',
        segment: 'inactive',
        days: 30,
        createdBy: 'test',
      });
      const broadcast = await claimMine(session.userId);
      expect(broadcast.items).toEqual([
        expect.objectContaining({ kind: 'broadcast', text: 'Новый сезон!' }),
      ]);
      await call(`/internal/bot/notifications/${broadcast.items[0]!.id}/result`, {
        outcome: 'blocked',
      });
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).botBlockedAt,
      ).not.toBeNull();
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'broadcast.create', targetId: broadcastId },
        }),
      ).toBe(1);
    });
  });

  describe('channel posts (D-145)', () => {
    it('queues a post only for a listed channel and only while the option is on', async () => {
      // Settings of this app instance only: other test files share the database.
      const texts = t.app.get(TextsService);
      const subscriptions = t.app.get(SubscriptionService);
      const broadcasts = t.app.get(BroadcastService);
      const channel = '-1009876543210';
      const base = await texts.settings();
      const options = vi.spyOn(texts, 'settings');
      vi.spyOn(subscriptions, 'settings').mockResolvedValue({
        enabled: false,
        channels: [{ chatId: '@spincards_news', title: 'Новости', url: 'https://t.me/news' }],
      });
      const queue = vi.spyOn(broadcasts, 'channelPost').mockResolvedValue(7);
      const post = (chatId: string, chatUsername?: string) =>
        call<BotChannelPostResponse>('/internal/bot/channel-post', {
          chatId,
          ...(chatUsername && { chatUsername }),
          messageId: 2,
        });
      try {
        options.mockResolvedValue({ ...base, bot: { supportChatId: null, channelPosts: false } });
        expect((await post(channel, 'spincards_news')).body.queued).toBe(0);
        options.mockResolvedValue({ ...base, bot: { supportChatId: null, channelPosts: true } });
        expect((await post(channel, 'SpinCards_News')).body.queued).toBe(7);
        expect(queue).toHaveBeenCalledWith(channel, 2);
        expect((await post('-1001111111111', 'other_news')).body.queued).toBe(0);
        expect((await post(channel)).body.queued).toBe(0);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('puts one row per reachable player and never twice for the same post', async () => {
      await call('/internal/bot/start', { user: botUser() });
      // Inside a rolled-back transaction: the shared outbox never sees these rows.
      const rollback = new Error('rollback');
      await expect(
        t.prisma.$transaction(
          async (tx) => {
            const first = await queueChannelPost(tx, '-1009876543210', 77);
            expect(first).toBeGreaterThan(0);
            expect(
              await tx.notificationOutbox.count({
                where: {
                  kind: 'channel_post',
                  dedupeKey: { startsWith: 'channel_post:-1009876543210:77:' },
                },
              }),
            ).toBe(first);
            // Again: players created meanwhile by other test files may join, nobody gets it twice.
            await queueChannelPost(tx, '-1009876543210', 77);
            const [rows] = await tx.$queryRaw<{ rows: bigint; users: bigint }[]>`
            SELECT count(*)::bigint AS rows, count(DISTINCT user_id)::bigint AS users
            FROM notifications_outbox WHERE dedupe_key LIKE 'channel_post:-1009876543210:77:%'`;
            expect(rows?.rows).toBe(rows?.users);
            throw rollback;
          },
          { timeout: 60_000 },
        ),
      ).rejects.toBe(rollback);
    });
  });

  describe('Stars payments (behind stars_enabled)', () => {
    const productId = `coins_${randomUUID().slice(0, 8)}`;

    beforeAll(async () => {
      await t.prisma.starProduct.create({
        data: {
          id: productId,
          kind: 'currency_bundle',
          starsPrice: 50,
          payload: { title: 'Монеты', money: { RUB: 500_000, USD: 5_000 } },
        },
      });
    });

    it('stays disabled while the flag is off', async () => {
      const session = await login(t);
      const res = await post<ErrorBody>(t, session, '/v1/payments/stars/invoice', { productId });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PAYMENTS_DISABLED');
    });

    it('creates an invoice, validates pre-checkout and credits a charge exactly once', async () => {
      patchFlags(t, { stars_enabled: true });
      const telegram = vi.fn((_url: string, _init: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: 'https://t.me/$invoice' }), {
            status: 200,
          }),
        ),
      );
      vi.stubGlobal('fetch', telegram);
      const telegramId = nextTelegramId();
      const session = await login(t, { telegramId });
      const invoice = await post<StarsInvoiceResponse>(t, session, '/v1/payments/stars/invoice', {
        productId,
      });
      expect(invoice.body.invoiceLink).toBe('https://t.me/$invoice');
      const sent = JSON.parse(telegram.mock.calls[0]![1].body as string) as Record<string, unknown>;
      expect(sent).toMatchObject({
        currency: 'XTR',
        payload: invoice.body.paymentId,
        prices: [{ label: 'Монеты', amount: 50 }],
      });
      expect(telegram.mock.calls[0]![0]).toContain('/createInvoiceLink');

      const base = {
        telegramId: String(telegramId),
        payload: invoice.body.paymentId,
        currency: 'XTR',
        totalAmount: 50,
      };
      const ok = await call<PreCheckoutResponse>('/internal/bot/payments/pre-checkout', base);
      expect(ok.body).toEqual({ ok: true });
      const wrong = await call<PreCheckoutResponse>('/internal/bot/payments/pre-checkout', {
        ...base,
        totalAmount: 1,
      });
      expect(wrong.body).toEqual({ ok: false, error: 'PAYMENT_INVALID' });
      const stranger = await call<PreCheckoutResponse>('/internal/bot/payments/pre-checkout', {
        ...base,
        telegramId: String(nextTelegramId()),
      });
      expect(stranger.body.ok).toBe(false);

      const wallet = () =>
        t.prisma.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId: session.userId, currency: 'RUB' } },
        });
      const before = (await wallet()).balance;
      const success = { ...base, telegramPaymentChargeId: `charge-${randomUUID()}` };
      const [a, b] = await Promise.all([
        call<SuccessfulPaymentResponse>('/internal/bot/payments/success', success),
        call<SuccessfulPaymentResponse>('/internal/bot/payments/success', success),
      ]);
      expect([a.body.credited, b.body.credited].sort()).toEqual([false, true]);
      expect((await wallet()).balance).toBe(before + 500_000n);
      expect(
        await t.prisma.payment.findUniqueOrThrow({ where: { id: invoice.body.paymentId } }),
      ).toMatchObject({ status: 'paid', telegramPaymentChargeId: success.telegramPaymentChargeId });
      expect(
        await t.prisma.ledgerEntry.count({
          where: { reason: 'stars_purchase', userId: session.userId },
        }),
      ).toBe(1);
      // Paid already: pre-checkout of the same payment is refused.
      expect(
        (await call<PreCheckoutResponse>('/internal/bot/payments/pre-checkout', base)).body.ok,
      ).toBe(false);
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });
  });
});
