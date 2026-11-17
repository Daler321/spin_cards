import {
  type Currency,
  type GameConfig,
  PATTERN_IDS,
  type PatternId,
  type PityFloor,
  type Region,
  type Tier,
  tierRank,
  TIERS,
} from '@spincards/shared';
import {
  emptyPackCounters,
  emptyPlayerCounters,
  type PackCounters,
  type PlayerCounters,
} from '../luck/state.js';
import type { CardPool, PooledCard, Rng } from '../ports.js';
import { createSeededRng } from '../seeded-rng.js';
import { resolveSpin, type SpinPayment } from '../spin.js';
import { cashoutFeeBp, cashoutPayout } from '../valuation.js';
import { type Distribution, distribution, ratioBp } from './stats.js';

export interface SimulationOptions {
  config: GameConfig;
  packId: string;
  region: Region;
  spins: number;
  /** Virtual players sharing the pool; spins are dealt round-robin. */
  players: number;
  /** Chance to pay with the held card when it can cover the price. */
  cardPaymentShareBp: number;
  /** Player level used for the cash-out fee. */
  level: number;
  seed: number;
  /** D-147: permanent bonus luck points on every spin (like a wheel or chest bonus). */
  bonusPoints?: number;
  /** Every player's total balance (minor units) for the hidden low-balance luck; unset: none. */
  totalBalance?: number;
  /** Spins every player has already made: skips the newbie window for the corridor check (D-116). */
  startSpins?: number;
  /**
   * Every spin is paid with a card of this many luck points (D-147), as players do with their best
   * card. Unset: the held card pays (cardPaymentShareBp of the time) with its own points.
   */
  cardLuckPoints?: number;
}

export interface RtpReport {
  /** Immediate cash-out value of every card divided by the prices paid, in bp. */
  overallBp: number;
  walletBp: number;
  cardBp: number;
  corridor: { minBp: number; maxBp: number };
  inCorridor: boolean;
}

export interface SimulationReport {
  packId: string;
  region: Region;
  currency: Currency;
  price: number;
  spins: number;
  players: number;
  seed: number;
  tiers: Record<Tier, { count: number; actualBp: number; configuredBp: number }>;
  balance: Distribution;
  /** Null for a free pack (nothing is paid). */
  rtp: RtpReport | null;
  patterns: { patternedShareBp: number; byId: Record<PatternId, number> };
  nearMiss: { shareBp: number; byId: Partial<Record<PatternId, number>> };
  streaks: { withoutRarePlus: Distribution; withoutEpicPlus: Distribution };
  luck: { lucky: number; newbie: number; pity: Record<PityFloor, number> };
  pool: { redrops: number; redropShareBp: number };
  payments: { wallet: number; card: number };
}

interface HeldCard {
  number: string;
  bankId: string;
  tier: Tier;
  balance: number;
  luckPoints: number;
  ownersCount: number;
}

interface VirtualPlayer {
  player: PlayerCounters;
  pack: PackCounters;
  held: HeldCard | null;
  sinceRarePlus: number;
  sinceEpicPlus: number;
}

/** In-memory pool. Numbers stay taken while pooled, see UniquenessChecker. */
class MemoryPool implements CardPool {
  private readonly queues = new Map<Tier, PooledCard[]>();
  private nextId = 0;

  release(card: HeldCard): void {
    const queue = this.queues.get(card.tier) ?? [];
    queue.push({
      id: `p${this.nextId++}`,
      number: card.number,
      bankId: card.bankId,
      ownersCount: card.ownersCount,
    });
    this.queues.set(card.tier, queue);
  }

  takeOldest(tier: Tier): Promise<PooledCard | null> {
    return Promise.resolve(this.queues.get(tier)?.shift() ?? null);
  }
}

/** Economy simulator (TZ 5.8). Deterministic for a given seed. */
export async function simulate(options: SimulationOptions): Promise<SimulationReport> {
  const { config, packId, region, spins, players: playerCount, seed } = options;
  const pack = config.packs.find((p) => p.id === packId);
  if (!pack) throw new RangeError(`unknown pack ${packId}`);
  const currency = config.regions[region].currency;
  const price = pack.free ? 0 : (pack.prices[currency] ?? 0);
  const feeBp = cashoutFeeBp(options.level, config);

  const rng: Rng = createSeededRng(seed);
  const pool = new MemoryPool();
  const issued = new Set<string>();
  const cellKey = (n: string, bankId: string, tier: Tier) => `${bankId}|${tier}|${n}`;
  const uniqueness = {
    isNumberFree: (n: string, cell: { bankId: string; tier: Tier }) =>
      Promise.resolve(!issued.has(cellKey(n, cell.bankId, cell.tier))),
  };
  const players: VirtualPlayer[] = Array.from({ length: playerCount }, () => ({
    player: { ...emptyPlayerCounters(), totalSpins: options.startSpins ?? 0 },
    pack: emptyPackCounters(),
    held: null,
    sinceRarePlus: 0,
    sinceEpicPlus: 0,
  }));

  const tierCounts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const patternCounts = Object.fromEntries(PATTERN_IDS.map((id) => [id, 0])) as Record<
    PatternId,
    number
  >;
  const nearMissCounts: Partial<Record<PatternId, number>> = {};
  const pity: Record<PityFloor, number> = { rare: 0, epic: 0, legendary: 0 };
  const balances = new Float64Array(spins);
  const rarePlusStreaks: number[] = [];
  const epicPlusStreaks: number[] = [];
  const paid = { wallet: 0, card: 0 };
  const payments = { wallet: 0, card: 0 };
  const payout = { wallet: 0, card: 0 };
  let patterned = 0;
  let nearMisses = 0;
  let lucky = 0;
  let newbie = 0;
  let redrops = 0;

  for (let i = 0; i < spins; i++) {
    const vp = players[i % playerCount] as VirtualPlayer;
    const held = vp.held;
    let payment: SpinPayment = { type: 'wallet' };
    if (options.cardLuckPoints !== undefined && price > 0) {
      payment = { type: 'card', luckPoints: options.cardLuckPoints };
    } else if (
      price > 0 &&
      held !== null &&
      held.balance >= price &&
      rng.int(0, 10_000) < options.cardPaymentShareBp
    ) {
      payment = { type: 'card', luckPoints: held.luckPoints };
      held.balance -= price;
    }

    const player = options.bonusPoints
      ? { ...vp.player, buffs: [{ points: options.bonusPoints, spinsLeft: 2 }] }
      : vp.player;
    const result = await resolveSpin(
      {
        config,
        packId,
        region,
        payment,
        player,
        pack: vp.pack,
        ...(options.totalBalance !== undefined && { totalBalance: options.totalBalance }),
      },
      { rng, uniqueness, pool: { takeOldest: (tier) => pool.takeOldest(tier) } },
    );
    vp.player = result.player;
    vp.pack = result.pack;

    const { card } = result;
    const channel = payment.type;
    payments[channel]++;
    paid[channel] += price;
    payout[channel] += cashoutPayout(card.balance, feeBp);
    balances[i] = card.balance;
    tierCounts[card.tier]++;
    if (card.patterns.length > 0) patterned++;
    for (const p of card.patterns) patternCounts[p.id]++;
    if (result.nearMiss) {
      nearMisses++;
      nearMissCounts[result.nearMiss.patternId] =
        (nearMissCounts[result.nearMiss.patternId] ?? 0) + 1;
    }
    if (result.lucky) lucky++;
    if (result.newbieStep !== null) newbie++;
    if (result.pityApplied) pity[result.pityApplied]++;
    if (card.source === 'pool') redrops++;
    else issued.add(cellKey(card.number, card.bankId, card.tier));

    vp.sinceRarePlus = trackStreak(
      vp.sinceRarePlus,
      tierRank(card.tier) >= tierRank('rare'),
      rarePlusStreaks,
    );
    vp.sinceEpicPlus = trackStreak(
      vp.sinceEpicPlus,
      tierRank(card.tier) >= tierRank('epic'),
      epicPlusStreaks,
    );

    // Keep the new card for paying if the current one cannot cover the next spin; the other goes
    // to the pool (cashed out), which feeds re-drops.
    const fresh: HeldCard = { ...card };
    if (!held || held.balance < price) {
      if (held) pool.release(held);
      vp.held = fresh;
    } else {
      pool.release(fresh);
    }
  }

  for (const vp of players) {
    if (vp.sinceRarePlus > 0) rarePlusStreaks.push(vp.sinceRarePlus);
    if (vp.sinceEpicPlus > 0) epicPlusStreaks.push(vp.sinceEpicPlus);
  }

  const weightTotal = TIERS.reduce((sum, t) => sum + pack.tierWeights[t], 0);
  const corridor = config.simulation.rtpCorridor;
  const overallBp = ratioBp(payout.wallet + payout.card, paid.wallet + paid.card);

  return {
    packId,
    region,
    currency,
    price,
    spins,
    players: playerCount,
    seed,
    tiers: Object.fromEntries(
      TIERS.map((t) => [
        t,
        {
          count: tierCounts[t],
          actualBp: ratioBp(tierCounts[t], spins),
          configuredBp: ratioBp(pack.tierWeights[t], weightTotal),
        },
      ]),
    ) as SimulationReport['tiers'],
    balance: distribution(balances),
    rtp:
      price > 0
        ? {
            overallBp,
            walletBp: ratioBp(payout.wallet, paid.wallet),
            cardBp: ratioBp(payout.card, paid.card),
            corridor,
            inCorridor: overallBp >= corridor.minBp && overallBp <= corridor.maxBp,
          }
        : null,
    patterns: { patternedShareBp: ratioBp(patterned, spins), byId: patternCounts },
    nearMiss: { shareBp: ratioBp(nearMisses, spins), byId: nearMissCounts },
    streaks: {
      withoutRarePlus: distribution(rarePlusStreaks),
      withoutEpicPlus: distribution(epicPlusStreaks),
    },
    luck: { lucky, newbie, pity },
    pool: { redrops, redropShareBp: ratioBp(redrops, spins) },
    payments,
  };
}

/** Counts spins since the last hit; records the streak length when a hit ends it. */
function trackStreak(current: number, hit: boolean, lengths: number[]): number {
  if (!hit) return current + 1;
  lengths.push(current);
  return 0;
}
