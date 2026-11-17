import type {
  AdminBroadcastItem,
  AdminAccount,
  AdminTextsResponse,
  AdminLoginResponse,
  AdminUserDetail,
  AdminUserListItem,
  StarsInvoiceResponse,
} from '@spincards/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  newTotpSecret,
  totpCode,
  verifyTotp,
} from '../src/admin/totp.js';
import { TextsService } from '../src/texts/texts.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { hashPassword } from '../src/seed/password.js';
import {
  createTestApp,
  idempotencyKey,
  login,
  nextTelegramId,
  patchFlags,
  post,
  type TestApp,
} from './support/app.js';
import { TEST_INTERNAL_TOKEN } from './support/env.js';

const SECRET_KEY = 'test-admin-secret-key-test-admin-secret-key';
const CSRF = { 'x-admin-request': '1' };
type ErrorBody = { error: { code: string } };

describe('TOTP', () => {
  it('matches the RFC 6238 test vector and round-trips secrets', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, 1)).toBe('287082'); // T = 59 s
    expect(verifyTotp(secret, '287082', 59_000)).toBe(1);
    expect(verifyTotp(secret, '287082', 59_000 + 120_000)).toBeNull();
    const fresh = newTotpSecret();
    expect(decryptSecret(encryptSecret(fresh, SECRET_KEY), SECRET_KEY)).toBe(fresh);
    expect(() =>
      decryptSecret(encryptSecret(fresh, SECRET_KEY), 'another-key-another-key-another'),
    ).toThrow();
  });
});

describe('admin API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const nowCode = (secret: string, offsetSteps = 0) =>
    totpCode(secret, Math.floor(Date.now() / 30_000) + offsetSteps);

  /** An admin with TOTP already set up, signed in: returns the cookie header. */
  async function adminSession(role: 'owner' | 'analyst' | 'support') {
    const loginName = `adm-${randomUUID().slice(0, 8)}`;
    const secret = newTotpSecret();
    await t.prisma.adminUser.create({
      data: {
        login: loginName,
        passwordHash: await hashPassword('pa55word!'),
        role,
        totpSecret: encryptSecret(secret, SECRET_KEY),
      },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { login: loginName, password: 'pa55word!', totp: nowCode(secret) },
    });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']).split(';')[0] ?? '';
    return { cookie: { cookie, ...CSRF }, login: loginName };
  }

  const as = async <T>(
    headers: Record<string, string>,
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ) => {
    const res = await t.app.inject({ method, url, headers, ...(payload && { payload }) });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };

  describe('sign-in', () => {
    it('sets TOTP up on the first login, then requires a fresh code', async () => {
      const loginName = `adm-${randomUUID().slice(0, 8)}`;
      await t.prisma.adminUser.create({
        data: { login: loginName, passwordHash: await hashPassword('secret-1'), role: 'support' },
      });
      const first = await as<AdminLoginResponse>({}, 'POST', '/admin/auth/login', {
        login: loginName,
        password: 'secret-1',
      });
      expect(first.body.stage).toBe('totp_setup');
      if (first.body.stage !== 'totp_setup') return;
      expect(first.body.otpauthUrl).toContain('otpauth://totp/');

      // The very code of the setup is replayed below (a fresh nowCode() could fall into the next
      // 30-second step and be a new, valid code).
      const setupCode = nowCode(first.body.secret);
      const setup = await t.app.inject({
        method: 'POST',
        url: '/admin/auth/totp/setup',
        payload: { setupToken: first.body.setupToken, code: setupCode },
      });
      expect(setup.json<AdminLoginResponse>()).toMatchObject({
        stage: 'done',
        admin: { login: loginName, role: 'support' },
      });
      const cookieHeader = String(setup.headers['set-cookie']);
      expect(cookieHeader).toMatch(/HttpOnly; SameSite=Strict/);
      const cookie = cookieHeader.split(';')[0] ?? '';
      const stored = await t.prisma.adminUser.findUniqueOrThrow({ where: { login: loginName } });
      expect(stored.totpSecret).not.toContain(first.body.secret); // encrypted at rest

      expect((await as({ cookie }, 'GET', '/admin/auth/me')).body).toMatchObject({
        login: loginName,
      });

      const again = await as<AdminLoginResponse>({}, 'POST', '/admin/auth/login', {
        login: loginName,
        password: 'secret-1',
      });
      expect(again.body.stage).toBe('totp_required');
      // The code used for the setup cannot be replayed.
      const replay = await as<ErrorBody>({}, 'POST', '/admin/auth/login', {
        login: loginName,
        password: 'secret-1',
        totp: setupCode,
      });
      expect(replay.body.error.code).toBe('ADMIN_TOTP_INVALID');

      await as({ cookie, ...CSRF }, 'POST', '/admin/auth/logout');
      expect((await as({ cookie }, 'GET', '/admin/auth/me')).status).toBe(401);
      expect(
        await t.prisma.auditLog.count({
          where: { actorId: stored.id, action: { startsWith: 'admin.' } },
        }),
      ).toBeGreaterThanOrEqual(3);
    });

    it('locks a login after five failures', async () => {
      const { login: loginName } = await adminSession('analyst');
      for (let i = 0; i < 5; i++) {
        const res = await as<ErrorBody>({}, 'POST', '/admin/auth/login', {
          login: loginName,
          password: 'wrong',
        });
        expect(res.body.error.code).toBe('ADMIN_INVALID_CREDENTIALS');
      }
      const locked = await as<ErrorBody>({}, 'POST', '/admin/auth/login', {
        login: loginName,
        password: 'pa55word!',
      });
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('ADMIN_LOCKED');
    });

    it('rejects player tokens, missing sessions and mutations without the CSRF header', async () => {
      const player = await login(t);
      expect((await as(player.auth, 'GET', '/admin/users')).status).toBe(401);
      const { cookie } = await adminSession('owner');
      const noCsrf = await t.app.inject({
        method: 'POST',
        url: `/admin/flags/near_miss_ux`,
        headers: { cookie: cookie.cookie },
        payload: { enabled: true, reason: 'test' },
      });
      expect(noCsrf.statusCode).toBe(403);
    });
  });

  describe('roles', () => {
    it('lets each role reach only its sections', async () => {
      const analyst = (await adminSession('analyst')).cookie;
      const support = (await adminSession('support')).cookie;
      const player = await login(t);
      expect((await as(analyst, 'GET', '/admin/users')).status).toBe(403);
      expect((await as(analyst, 'GET', '/admin/pool')).status).toBe(200);
      expect((await as(support, 'GET', '/admin/users')).status).toBe(200);
      expect((await as(support, 'GET', '/admin/audit')).status).toBe(403);
      const adjust = await as(support, 'POST', `/admin/users/${player.userId}/adjust`, {
        currency: 'RUB',
        amount: 100,
        reason: 'проверка роли',
        idempotencyKey: idempotencyKey(),
      });
      expect(adjust.status).toBe(403);
    });
  });

  describe('players', () => {
    it('finds a player, adjusts the balance through the ledger and bans', async () => {
      const owner = (await adminSession('owner')).cookie;
      const telegramId = nextTelegramId();
      const player = await login(t, { telegramId, firstName: 'Поддержка' });

      const found = await as<AdminUserListItem[]>(
        owner,
        'GET',
        `/admin/users?q=${String(telegramId)}`,
      );
      expect(found.body.map((u) => u.id)).toEqual([player.userId]);

      const key = idempotencyKey();
      const credit = {
        currency: 'RUB',
        amount: 12_345,
        reason: 'компенсация сбоя',
        idempotencyKey: key,
      };
      const first = await as<{ balance: number }>(
        owner,
        'POST',
        `/admin/users/${player.userId}/adjust`,
        credit,
      );
      const repeat = await as<{ balance: number }>(
        owner,
        'POST',
        `/admin/users/${player.userId}/adjust`,
        credit,
      );
      expect(repeat.body.balance).toBe(first.body.balance);
      expect(
        await t.prisma.ledgerEntry.count({
          where: { userId: player.userId, reason: 'admin_adjust' },
        }),
      ).toBe(1);
      const tooMuch = await as<ErrorBody>(owner, 'POST', `/admin/users/${player.userId}/adjust`, {
        currency: 'RUB',
        amount: -(first.body.balance + 1),
        reason: 'списание',
        idempotencyKey: idempotencyKey(),
      });
      expect(tooMuch.body.error.code).toBe('INSUFFICIENT_FUNDS');
      const noReason = await as(owner, 'POST', `/admin/users/${player.userId}/adjust`, {
        currency: 'RUB',
        amount: 1,
        reason: '',
        idempotencyKey: idempotencyKey(),
      });
      expect(noReason.status).toBe(400);

      await as(owner, 'POST', `/admin/users/${player.userId}/buff`, {
        points: 10,
        spins: 3,
        reason: 'извинение',
      });
      const detail = await as<AdminUserDetail>(owner, 'GET', `/admin/users/${player.userId}`);
      expect(detail.body.buffs).toEqual([
        expect.objectContaining({ points: 10, spinsLeft: 3, source: 'admin' }),
      ]);
      expect(detail.body.ledger[0]).toMatchObject({ reason: 'admin_adjust', delta: 12_345 });

      // A card balance can be changed too (owner, through the ledger).
      const spin = await post<{ spins: { card: { id: string; balance: number } }[] }>(
        t,
        player,
        '/v1/spin',
        { packId: 'basic', payment: { type: 'wallet' } },
      );
      const card = spin.body.spins[0]!.card;
      const cardUrl = `/admin/users/${player.userId}/cards/${card.id}/adjust`;
      const cardAdjust = await as<{ balance: number }>(owner, 'POST', cardUrl, {
        amount: -100,
        reason: 'списание с карты',
        idempotencyKey: idempotencyKey(),
      });
      expect(cardAdjust.body.balance).toBe(card.balance - 100);
      const tooMuchCard = await as<ErrorBody>(owner, 'POST', cardUrl, {
        amount: -card.balance,
        reason: 'списание с карты',
        idempotencyKey: idempotencyKey(),
      });
      expect(tooMuchCard.body.error.code).toBe('INSUFFICIENT_FUNDS');

      await as(owner, 'POST', `/admin/users/${player.userId}/ban`, {
        banned: true,
        reason: 'мультиаккаунт',
      });
      const me = await t.app.inject({ url: '/v1/me', headers: player.auth });
      expect(me.json<ErrorBody>().error.code).toBe('USER_BANNED');
      const audit = await t.prisma.auditLog.findMany({
        where: { targetType: 'user', targetId: player.userId },
        orderBy: { id: 'asc' },
      });
      expect(audit.map((a) => [a.action, a.reason])).toEqual([
        ['user.adjust', 'компенсация сбоя'],
        ['user.buff', 'извинение'],
        ['card.adjust', 'списание с карты'],
        ['user.ban', 'мультиаккаунт'],
      ]);
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });
  });

  describe('operations', () => {
    it('previews and queues a broadcast, flips a flag and pages the audit log', async () => {
      const owner = (await adminSession('owner')).cookie;
      await login(t);
      const preview = await as<{ recipients: number }>(
        owner,
        'GET',
        '/admin/broadcasts/preview?segment=active&days=1',
      );
      expect(preview.body.recipients).toBeGreaterThan(0);
      const created = await as<{ id: string; recipients: number }>(
        owner,
        'POST',
        '/admin/broadcasts',
        {
          text: 'Тестовая рассылка',
          segment: 'active',
          days: 1,
        },
      );
      expect(created.body.recipients).toBeGreaterThanOrEqual(preview.body.recipients);
      const list = await as<AdminBroadcastItem[]>(owner, 'GET', '/admin/broadcasts');
      expect(list.body.find((b) => b.id === created.body.id)).toMatchObject({
        text: 'Тестовая рассылка',
        pending: created.body.recipients,
      });

      const flag = await as(owner, 'POST', '/admin/flags/near_miss_ux', {
        enabled: true,
        reason: 'проверка',
      });
      expect(flag.status).toBe(204);
      const audit = await as<{ items: { action: string }[]; nextCursor: string | null }>(
        owner,
        'GET',
        '/admin/audit?action=flag.',
      );
      expect(audit.body.items[0]?.action).toBe('flag.set');
      expect((await as(owner, 'GET', '/admin/seasons')).status).toBe(200);
    });

    it('refunds a Stars payment: takes the product back, then returns the Stars', async () => {
      const owner = (await adminSession('owner')).cookie;
      patchFlags(t, { stars_enabled: true });
      const productId = `coins_${randomUUID().slice(0, 8)}`;
      await t.prisma.starProduct.create({
        data: {
          id: productId,
          kind: 'currency_bundle',
          starsPrice: 20,
          payload: { money: { RUB: 70_000, USD: 700 } },
        },
      });
      const telegramCalls: string[] = [];
      let refundOk = false;
      vi.stubGlobal('fetch', (url: string) => {
        telegramCalls.push(url);
        const result = url.endsWith('/createInvoiceLink') ? 'https://t.me/$x' : refundOk;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              result === false
                ? { ok: false, description: 'CHARGE_NOT_FOUND' }
                : { ok: true, result },
            ),
            {
              status: 200,
            },
          ),
        );
      });
      const telegramId = nextTelegramId();
      const player = await login(t, { telegramId });
      const invoice = await post<StarsInvoiceResponse>(t, player, '/v1/payments/stars/invoice', {
        productId,
      });
      await t.app.inject({
        method: 'POST',
        url: '/internal/bot/payments/success',
        headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
        payload: {
          telegramId: String(telegramId),
          payload: invoice.body.paymentId,
          currency: 'XTR',
          totalAmount: 20,
          telegramPaymentChargeId: `ch-${randomUUID()}`,
        },
      });
      const wallet = () =>
        t.prisma.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId: player.userId, currency: 'RUB' } },
        });
      const paid = (await wallet()).balance;

      // Telegram refuses: nothing changes.
      const failed = await as(owner, 'POST', `/admin/payments/${invoice.body.paymentId}/refund`, {
        reason: 'жалоба',
      });
      expect(failed.status).toBe(500);
      expect((await wallet()).balance).toBe(paid);
      expect(
        (await t.prisma.payment.findUniqueOrThrow({ where: { id: invoice.body.paymentId } }))
          .status,
      ).toBe('paid');

      refundOk = true;
      const ok = await as(owner, 'POST', `/admin/payments/${invoice.body.paymentId}/refund`, {
        reason: 'жалоба',
      });
      expect(ok.status).toBe(204);
      expect((await wallet()).balance).toBe(paid - 70_000n);
      expect(telegramCalls.at(-1)).toContain('/refundStarPayment');
      const again = await as<ErrorBody>(
        owner,
        'POST',
        `/admin/payments/${invoice.body.paymentId}/refund`,
        {
          reason: 'повтор',
        },
      );
      expect(again.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });
  });

  describe('admin accounts (D-120)', () => {
    it('lets the owner create admins and change their access, but never lock themselves out', async () => {
      const owner = await adminSession('owner');
      const support = await adminSession('support');
      const me = (await as<AdminAccount[]>(owner.cookie, 'GET', '/admin/admins')).body.find(
        (a) => a.login === owner.login,
      )!;

      // Only the owner manages admins.
      expect((await as(support.cookie, 'GET', '/admin/admins')).status).toBe(403);

      const login = `new-${randomUUID().slice(0, 6)}`;
      const create = { login, role: 'analyst', password: 'x'.repeat(12), reason: 'новый аналитик' };
      expect((await as(owner.cookie, 'POST', '/admin/admins', create)).status).toBe(204);
      const again = await as<ErrorBody>(owner.cookie, 'POST', '/admin/admins', create);
      expect(again.body.error.code).toBe('ADMIN_LOGIN_TAKEN');
      expect(
        (
          await as(owner.cookie, 'POST', '/admin/admins', {
            ...create,
            login: 'x',
            password: 'short',
          })
        ).status,
      ).toBe(400);

      const list = (await as<AdminAccount[]>(owner.cookie, 'GET', '/admin/admins')).body;
      expect(list.find((a) => a.login === login)).toMatchObject({
        role: 'analyst',
        isActive: true,
        totpEnabled: false,
      });

      // The new admin signs in with the temporary password and is asked to set up TOTP.
      const first = await as<AdminLoginResponse>({}, 'POST', '/admin/auth/login', {
        login,
        password: 'x'.repeat(12),
      });
      expect(first.body.stage).toBe('totp_setup');

      // The owner cannot demote or disable themselves.
      const self = (body: object) =>
        as<ErrorBody>(owner.cookie, 'POST', `/admin/admins/${me.id}`, { ...body, reason: 'тест' });
      expect((await self({ role: 'support' })).status).toBe(403);
      expect((await self({ isActive: false })).status).toBe(403);

      // Disabling an admin ends their sessions at once.
      const supportId = (await as<AdminAccount[]>(owner.cookie, 'GET', '/admin/admins')).body.find(
        (a) => a.login === support.login,
      )!.id;
      expect((await as(support.cookie, 'GET', '/admin/users?q=1')).status).toBe(200);
      expect(
        (
          await as(owner.cookie, 'POST', `/admin/admins/${supportId}`, {
            isActive: false,
            reason: 'ушёл из проекта',
          })
        ).status,
      ).toBe(204);
      expect((await as(support.cookie, 'GET', '/admin/users?q=1')).status).toBe(401);
      expect(
        await t.prisma.auditLog.count({ where: { action: 'admin.update', targetId: supportId } }),
      ).toBe(1);
    });
  });

  describe('texts (D-134)', () => {
    it('lets the owner override a text, refuses unknown placeholders and resets it', async () => {
      const owner = (await adminSession('owner')).cookie;
      const set = (key: string, value: string | null) =>
        as<ErrorBody>(owner, 'POST', '/admin/settings/texts', { key, value, reason: 'тест' });
      expect((await set('game:subscribe.title', 'Сначала подпишитесь')).status).toBe(204);
      expect((await set('bot:start.greeting', 'Привет, {name}!')).status).toBe(204);
      const bad = await set('bot:start.greeting', 'Привет, {nick}!');
      expect(bad.body.error.code).toBe('TEXT_PLACEHOLDER_INVALID');
      expect(
        (
          await as(owner, 'POST', '/admin/settings/texts/start-link', {
            startLink: { text: 'Канал', url: 'https://t.me/spincards' },
            reason: 'тест',
          })
        ).status,
      ).toBe(204);

      const view = await as<AdminTextsResponse>(owner, 'GET', '/admin/settings/texts');
      expect(view.body.items.find((i) => i.key === 'game:subscribe.title')?.override).toBe(
        'Сначала подпишитесь',
      );
      const publicConfig = await t.app.inject({ url: '/v1/config/public' });
      expect(publicConfig.json<{ texts: Record<string, string> }>().texts).toMatchObject({
        'game:subscribe.title': 'Сначала подпишитесь',
      });
      const texts = t.app.get(TextsService);
      expect(await texts.bot()).toEqual({
        overrides: { 'bot:start.greeting': 'Привет, {name}!' },
        startLink: { text: 'Канал', url: 'https://t.me/spincards' },
        bot: { supportChatId: null, channelPosts: false },
      });

      // D-145: support group and channel posts; a bad chat id is refused.
      const bot = (supportChatId: string | null, channelPosts: boolean) =>
        as(owner, 'POST', '/admin/settings/texts/bot', {
          bot: { supportChatId, channelPosts },
          reason: 'тест',
        });
      expect((await bot('-1001234567890', true)).status).toBe(204);
      expect((await texts.bot()).bot).toEqual({
        supportChatId: '-1001234567890',
        channelPosts: true,
      });
      expect((await bot('@support', true)).status).toBe(400);
      expect((await bot(null, false)).status).toBe(204);

      // Back to the defaults: the settings table is shared with other test files.
      await set('game:subscribe.title', null);
      await set('bot:start.greeting', null);
      await as(owner, 'POST', '/admin/settings/texts/start-link', {
        startLink: null,
        reason: 'тест',
      });
      expect(await texts.bot()).toEqual({
        overrides: {},
        startLink: null,
        bot: { supportChatId: null, channelPosts: false },
      });
    });
  });
});
