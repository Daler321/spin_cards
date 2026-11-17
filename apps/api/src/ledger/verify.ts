import type { PrismaClient } from '../generated/prisma/client.js';

export interface LedgerMismatch {
  accountType: 'wallet' | 'card';
  accountId: string;
  balance: bigint;
  ledgerSum: bigint;
  lastBalanceAfter: bigint | null;
}

/**
 * Every cached balance must equal the sum of its ledger entries and the last entry's balance_after
 * (CLAUDE.md). Returns all accounts that violate it; an empty list means the books are consistent.
 */
export async function findLedgerMismatches(prisma: PrismaClient): Promise<LedgerMismatch[]> {
  return prisma.$queryRaw<LedgerMismatch[]>`
    WITH accounts AS (
      SELECT 'wallet'::text AS account_type, id, balance FROM wallets
      UNION ALL
      SELECT 'card'::text, id, balance FROM cards
    ),
    sums AS (
      SELECT account_type::text, account_id, SUM(delta) AS ledger_sum,
             (ARRAY_AGG(balance_after ORDER BY id DESC))[1] AS last_balance_after
      FROM ledger_entries GROUP BY account_type, account_id
    )
    SELECT a.account_type AS "accountType", a.id::text AS "accountId", a.balance,
           COALESCE(s.ledger_sum, 0)::bigint AS "ledgerSum", s.last_balance_after AS "lastBalanceAfter"
    FROM accounts a
    LEFT JOIN sums s ON s.account_type = a.account_type AND s.account_id = a.id
    WHERE a.balance <> COALESCE(s.ledger_sum, 0)
       OR (s.last_balance_after IS NOT NULL AND a.balance <> s.last_balance_after)
       OR (s.last_balance_after IS NULL AND a.balance <> 0)`;
}
