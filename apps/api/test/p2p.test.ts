import { randomUUID } from 'node:crypto';
import type { P2pRecipient, P2pSendResponse } from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  fund,
  idempotencyKey,
  login,
  post,
  type Session,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('transfers between players (D-131)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const player = async (level = 3) => {
    const session = await login(t);
    const username = `P2p_${randomUUID().slice(0, 8)}`;
    await t.prisma.user.update({ where: { id: session.userId }, data: { username, level } });
    return { session, username };
  };
  const rub = async (s: Session) =>
    (
      await t.prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId: s.userId, currency: 'RUB' } },
      })
    ).balance;
  const send = (s: Session, username: string, amount: number, key = idempotencyKey()) =>
    post<P2pSendResponse & ErrorBody>(t, s, '/v1/wallet/send', {
      username,
      currency: 'RUB',
      amount,
      idempotencyKey: key,
    });

  it('finds the recipient by @username and sends money minus the fee, once', async () => {
    const a = await player();
    const b = await player();
    const found = await t.app.inject({
      url: `/v1/wallet/recipient?username=@${b.username.toUpperCase()}`,
      headers: a.session.auth,
    });
    expect(found.json<P2pRecipient>()).toMatchObject({ userId: b.session.userId, level: 3 });
    const self = await t.app.inject({
      url: `/v1/wallet/recipient?username=${a.username}`,
      headers: a.session.auth,
    });
    expect(self.json<ErrorBody>().error.code).toBe('P2P_RECIPIENT_NOT_FOUND');

    const [aBefore, bBefore] = [await rub(a.session), await rub(b.session)];
    const key = idempotencyKey();
    const res = await send(a.session, `@${b.username}`, 100_000, key);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 100_000, fee: 2000, received: 98_000 });
    expect((await send(a.session, b.username, 100_000, key)).body).toEqual(res.body);
    expect(await rub(a.session)).toBe(aBefore - 100_000n);
    expect(await rub(b.session)).toBe(bBefore + 98_000n);
    expect(
      await t.prisma.notificationOutbox.count({
        where: { userId: b.session.userId, kind: 'p2p_received' },
      }),
    ).toBe(1);
  });

  it('needs level 3 on both sides, a minimum amount and respects the daily limit', async () => {
    const a = await player();
    const low = await player(2);
    expect((await send(a.session, low.username, 100_000)).body.error.code).toBe(
      'P2P_LEVEL_TOO_LOW',
    );
    const b = await player();
    expect((await send(a.session, b.username, 100)).body.error.code).toBe('P2P_BELOW_MINIMUM');
    await fund(t, a.session.userId, 'RUB', 60_000_000n);
    expect((await send(a.session, b.username, 45_000_000)).status).toBe(200);
    expect((await send(a.session, b.username, 10_000_000)).body.error.code).toBe(
      'P2P_LIMIT_EXCEEDED',
    );
  });

  it('keeps the books balanced under transfers in both directions at once', async () => {
    const a = await player();
    const b = await player();
    await fund(t, a.session.userId, 'RUB', 5_000_000n);
    await fund(t, b.session.userId, 'RUB', 5_000_000n);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 ? send(a.session, b.username, 50_000) : send(b.session, a.username, 50_000),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });
});
