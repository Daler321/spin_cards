import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { LedgerAccountType, type LedgerReason } from '../generated/prisma/client.js';
import type { Tx } from '../prisma/prisma.service.js';

export interface AccountRef {
  type: LedgerAccountType;
  id: string;
}

export interface Posting {
  account: AccountRef;
  delta: bigint;
  reason: LedgerReason;
  ref?: { type: string; id: string };
}

export interface LockedAccount extends AccountRef {
  userId: string | null;
  currency: string;
  balance: bigint;
}

interface LockedRow {
  id: string;
  user_id: string | null;
  currency: string;
  balance: bigint;
}

const keyOf = (account: AccountRef) => `${account.type}:${account.id}`;

/**
 * The only way to change a balance (CLAUDE.md): rows are locked with SELECT … FOR UPDATE (wallets
 * before cards, each by id, so concurrent operations never deadlock), every change is journaled in
 * ledger_entries with balance_after, and the cached balance is updated in the same transaction.
 */
@Injectable()
export class LedgerService {
  async lock(tx: Tx, accounts: readonly AccountRef[]): Promise<Map<string, LockedAccount>> {
    const walletIds = uniqueIds(accounts, LedgerAccountType.wallet);
    const cardIds = uniqueIds(accounts, LedgerAccountType.card);
    const locked = new Map<string, LockedAccount>();

    if (walletIds.length > 0) {
      const rows = await tx.$queryRaw<LockedRow[]>`
        SELECT id::text, user_id::text, currency, balance FROM wallets
        WHERE id = ANY(${walletIds}::uuid[]) ORDER BY id FOR UPDATE`;
      for (const row of rows)
        locked.set(`wallet:${row.id}`, toLocked(LedgerAccountType.wallet, row));
    }
    if (cardIds.length > 0) {
      const rows = await tx.$queryRaw<LockedRow[]>`
        SELECT id::text, owner_id::text AS user_id, currency, balance FROM cards
        WHERE id = ANY(${cardIds}::uuid[]) ORDER BY id FOR UPDATE`;
      for (const row of rows) locked.set(`card:${row.id}`, toLocked(LedgerAccountType.card, row));
    }

    for (const account of accounts) {
      if (!locked.has(keyOf(account)))
        throw new Error(`ledger account not found: ${keyOf(account)}`);
    }
    return locked;
  }

  /**
   * Applies postings in order. Throws INSUFFICIENT_FUNDS if any account would go negative.
   * Returns the new balance of every touched account, keyed by "type:id".
   */
  async post(
    tx: Tx,
    postings: readonly Posting[],
    context: { seasonId: string },
  ): Promise<Map<string, bigint>> {
    const effective = postings.filter((posting) => posting.delta !== 0n);
    const accounts = await this.lock(
      tx,
      effective.map((posting) => posting.account),
    );

    const balances = new Map<string, bigint>();
    const entries = effective.map((posting) => {
      const key = keyOf(posting.account);
      const account = accounts.get(key) as LockedAccount;
      const balanceAfter = (balances.get(key) ?? account.balance) + posting.delta;
      if (balanceAfter < 0n) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, HttpStatus.CONFLICT);
      balances.set(key, balanceAfter);
      return {
        accountType: account.type,
        accountId: account.id,
        userId: account.userId,
        currency: account.currency,
        delta: posting.delta,
        balanceAfter,
        reason: posting.reason,
        refType: posting.ref?.type ?? null,
        refId: posting.ref?.id ?? null,
        seasonId: context.seasonId,
      };
    });

    for (const [key, balance] of balances) {
      const account = accounts.get(key) as LockedAccount;
      if (account.type === LedgerAccountType.wallet) {
        await tx.wallet.update({ where: { id: account.id }, data: { balance } });
      } else {
        await tx.card.update({ where: { id: account.id }, data: { balance } });
      }
    }
    if (entries.length > 0) await tx.ledgerEntry.createMany({ data: entries });
    return balances;
  }
}

export function accountKey(account: AccountRef): string {
  return keyOf(account);
}

function uniqueIds(accounts: readonly AccountRef[], type: LedgerAccountType): string[] {
  return [...new Set(accounts.filter((a) => a.type === type).map((a) => a.id))].sort();
}

function toLocked(type: LedgerAccountType, row: LockedRow): LockedAccount {
  return { type, id: row.id, userId: row.user_id, currency: row.currency, balance: row.balance };
}
