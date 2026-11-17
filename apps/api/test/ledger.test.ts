import { HttpException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeasonService } from '../src/game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../src/generated/prisma/client.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { createTestApp, idempotencyKey, login, type TestApp } from './support/app.js';

describe('ledger', () => {
  let t: TestApp;
  let ledger: LedgerService;
  let seasonId: string;

  beforeAll(async () => {
    t = await createTestApp();
    ledger = t.app.get(LedgerService);
    seasonId = await t.app.get(SeasonService).currentSeasonId();
  });

  afterAll(() => t.close());

  const rubWallet = (userId: string) =>
    t.prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId, currency: 'RUB' } } });

  it('keeps balance = SUM(ledger) under 100 parallel conversions', async () => {
    const session = await login(t);
    // 5 000 ₽ start; each conversion takes 100 ₽, so exactly 50 can succeed.
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        t.app.inject({
          method: 'POST',
          url: '/v1/wallet/convert',
          headers: session.auth,
          payload: { from: 'RUB', to: 'USD', amount: 10_000, idempotencyKey: idempotencyKey() },
        }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 200);
    const failed = results.filter((r) => r.statusCode !== 200);
    expect(ok).toHaveLength(50);
    expect(
      failed.every(
        (r) => r.json<{ error: { code: string } }>().error.code === 'INSUFFICIENT_FUNDS',
      ),
    ).toBe(true);

    const wallet = await rubWallet(session.userId);
    expect(wallet.balance).toBe(0n);
    const sum = await t.prisma.ledgerEntry.aggregate({
      where: { accountType: 'wallet', accountId: wallet.id },
      _sum: { delta: true },
    });
    expect(sum._sum.delta).toBe(0n);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('applies 20 parallel requests with one idempotency key exactly once', async () => {
    const session = await login(t);
    const payload = { from: 'RUB', to: 'USD', amount: 10_000, idempotencyKey: idempotencyKey() };
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        t.app.inject({ method: 'POST', url: '/v1/wallet/convert', headers: session.auth, payload }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    // Replays come from jsonb (keys reordered), so compare parsed bodies.
    const first = results[0]!.json<unknown>();
    for (const r of results) expect(r.json()).toEqual(first);
    expect((await rubWallet(session.userId)).balance).toBe(490_000n);
    expect(await t.prisma.currencyConversion.count({ where: { userId: session.userId } })).toBe(1);
  });

  it('never lets a balance go negative, even within one batch', async () => {
    const session = await login(t);
    const wallet = await rubWallet(session.userId);
    const account = { type: LedgerAccountType.wallet, id: wallet.id };
    await expect(
      t.prisma.transaction((tx) =>
        ledger.post(
          tx,
          [
            { account, delta: -600_000n, reason: LedgerReason.admin_adjust },
            { account, delta: 200_000n, reason: LedgerReason.admin_adjust },
          ],
          { seasonId },
        ),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect((await rubWallet(session.userId)).balance).toBe(500_000n);
  });

  it('records balance_after for each posting', async () => {
    const session = await login(t);
    const wallet = await rubWallet(session.userId);
    const account = { type: LedgerAccountType.wallet, id: wallet.id };
    const balances = await t.prisma.transaction((tx) =>
      ledger.post(
        tx,
        [
          { account, delta: -100n, reason: LedgerReason.admin_adjust },
          { account, delta: -50n, reason: LedgerReason.admin_adjust },
          { account, delta: 0n, reason: LedgerReason.admin_adjust },
        ],
        { seasonId },
      ),
    );
    expect(balances.get(`wallet:${wallet.id}`)).toBe(499_850n);
    const entries = await t.prisma.ledgerEntry.findMany({
      where: { accountId: wallet.id, reason: 'admin_adjust' },
      orderBy: { id: 'asc' },
    });
    expect(entries.map((e) => e.balanceAfter)).toEqual([499_900n, 499_850n]);
  });

  it('rejects UPDATE and DELETE on ledger entries in the database', async () => {
    const session = await login(t);
    const entry = await t.prisma.ledgerEntry.findFirstOrThrow({
      where: { userId: session.userId },
    });
    await expect(
      t.prisma.$executeRaw`UPDATE ledger_entries SET delta = 1 WHERE id = ${entry.id}`,
    ).rejects.toThrow(/not allowed/);
    await expect(
      t.prisma.$executeRaw`DELETE FROM ledger_entries WHERE id = ${entry.id}`,
    ).rejects.toThrow(/not allowed/);
  });

  it('detects a cached balance edited around the ledger', async () => {
    const session = await login(t);
    const wallet = await rubWallet(session.userId);
    await t.prisma
      .$executeRaw`UPDATE wallets SET balance = balance + 1 WHERE id = ${wallet.id}::uuid`;
    const mismatches = await findLedgerMismatches(t.prisma);
    expect(mismatches).toEqual([
      expect.objectContaining({
        accountType: 'wallet',
        accountId: wallet.id,
        balance: 500_001n,
        ledgerSum: 500_000n,
      }),
    ]);
    await t.prisma
      .$executeRaw`UPDATE wallets SET balance = balance - 1 WHERE id = ${wallet.id}::uuid`;
  });
});
