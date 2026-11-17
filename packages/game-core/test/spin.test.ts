import { tierRank } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  emptyPackCounters,
  emptyPlayerCounters,
  type PackCounters,
  type PlayerCounters,
  resolveSpin,
  type SpinInput,
  SpinRejectedError,
  type SpinResult,
} from '../src/index.js';
import { alwaysFree, config, emptyPool, poolOf } from './helpers.js';

const veteran = (): PlayerCounters => ({ ...emptyPlayerCounters(), totalSpins: 100 });

function input(overrides: Partial<SpinInput> = {}): SpinInput {
  return {
    config: config(),
    packId: 'basic',
    region: 'RU',
    payment: { type: 'wallet' },
    player: veteran(),
    pack: emptyPackCounters(),
    ...overrides,
  };
}

const spin = (overrides: Partial<SpinInput> = {}, seed = 1, pool = emptyPool) =>
  resolveSpin(input(overrides), { rng: createSeededRng(seed), uniqueness: alwaysFree, pool });

describe('resolveSpin', () => {
  it('returns a fully valued card', async () => {
    const { card } = await spin();
    expect(card.source).toBe('new');
    expect(card.number).toMatch(/^9\d{15}$/);
    expect(card.currency).toBe('RUB');
    expect(['lemon', 'azure', 'ruby', 'emerald']).toContain(card.bankId);
    expect(card.baseLimit).toBeGreaterThanOrEqual(34_000);
    expect(card.baseLimit).toBeLessThanOrEqual(101_000);
    expect(card.ownersCount).toBe(1);
    expect(card.lifespanHours).toBe(config().tiers[card.tier].lifespanHours);
  });

  it('uses the region currency, banks and price', async () => {
    const { card } = await spin({ region: 'US' });
    expect(card.currency).toBe('USD');
    expect(['liberty', 'eagle', 'evergreen', 'frontier']).toContain(card.bankId);
  });

  it('follows the newbie script: Rare, Common, Epic, then boosted rolls', async () => {
    let player = emptyPlayerCounters();
    let pack: PackCounters = emptyPackCounters();
    const results: SpinResult[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await spin({ player, pack }, 10 + i);
      results.push(result);
      ({ player, pack } = result);
    }
    expect(results.slice(0, 3).map((r) => r.card.tier)).toEqual(['rare', 'common', 'epic']);
    expect(results.map((r) => r.newbieStep)).toEqual([0, 1, 2, 3, 4, null]);
    expect(results[3]?.rolled.rarePlusBoostBp).toBe(1000);
    expect(results[5]?.rolled.rarePlusBoostBp).toBe(0);
    expect(player.totalSpins).toBe(6);
  });

  describe('hidden starter luck (D-116)', () => {
    const rich = 3_000_000;
    it('boosts the first spins of a newcomer whatever the balance', async () => {
      const first = await spin({ player: emptyPlayerCounters(), totalBalance: 10_000_000 });
      expect(first.rolled.hiddenBoostBp).toBe(30_000);
      const last = await spin({
        player: { ...emptyPlayerCounters(), totalSpins: 19 },
        totalBalance: 10_000_000,
      });
      expect(last.rolled.hiddenBoostBp).toBe(30_000);
      const after = await spin({
        player: { ...emptyPlayerCounters(), totalSpins: 20 },
        totalBalance: 10_000_000,
      });
      expect(after.rolled.hiddenBoostBp).toBe(0);
    });

    it('doubles Rare+ odds for anyone below the balance threshold', async () => {
      expect((await spin({ totalBalance: rich - 1 })).rolled.hiddenBoostBp).toBe(10_000);
      expect((await spin({ totalBalance: rich })).rolled.hiddenBoostBp).toBe(0);
      expect((await spin()).rolled.hiddenBoostBp).toBe(0);
      expect((await spin({ region: 'US', totalBalance: 34_999 })).rolled.hiddenBoostBp).toBe(
        10_000,
      );
      expect((await spin({ region: 'US', totalBalance: 35_000 })).rolled.hiddenBoostBp).toBe(0);
    });

    it('scales Rare+ weights past the usual cap and leaves Common alone', async () => {
      const base = await spin({ totalBalance: rich });
      const boosted = await spin({ totalBalance: 0 });
      expect(boosted.rolled.tierWeights.common).toBe(base.rolled.tierWeights.common);
      expect(boosted.rolled.tierWeights.rare).toBe(base.rolled.tierWeights.rare * 2);
      expect(boosted.rolled.tierWeights.epic).toBe(base.rolled.tierWeights.epic * 2);
    });

    it('is off when the config says so', async () => {
      const c = config();
      c.luck.hidden = { ...c.luck.hidden, lowBalanceBoostBp: 0, newbieSpins: 0 };
      const r = await spin({ config: c, player: emptyPlayerCounters(), totalBalance: 0 });
      expect(r.rolled.hiddenBoostBp).toBe(0);
    });
  });

  it('applies pity and lets it override a lower scripted tier', async () => {
    const pack = { ...emptyPackCounters(), sinceFloor: { rare: 7, epic: 0, legendary: 0 } };
    for (const player of [veteran(), { ...emptyPlayerCounters(), totalSpins: 1 }]) {
      for (let seed = 0; seed < 20; seed++) {
        const result = await spin({ pack, player }, seed);
        expect(result.pityApplied).toBe('rare');
        expect(tierRank(result.card.tier)).toBeGreaterThanOrEqual(tierRank('rare'));
        expect(result.pack.sinceFloor.rare).toBe(0);
      }
    }
  });

  it('makes every 500th spin a milestone of at least Epic', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const result = await spin(
        {
          player: { ...emptyPlayerCounters(), totalSpins: 499 },
          pack: { ...emptyPackCounters(), luckMeter: 30 },
        },
        seed,
      );
      expect(result.lucky).toBe('milestone');
      expect(tierRank(result.card.tier)).toBeGreaterThanOrEqual(tierRank('epic'));
      // The meter is not spent on a milestone spin.
      expect(result.pack.luckMeter).toBe(30);
    }
    const ordinary = await spin({ player: { ...emptyPlayerCounters(), totalSpins: 500 } });
    expect(ordinary.lucky).toBeNull();
  });

  it('makes a full meter spin lucky and resets the meter', async () => {
    const result = await spin({ pack: { ...emptyPackCounters(), luckMeter: 30 } });
    expect(result.lucky).toBe('meter');
    expect(result.rolled.tierWeights.epic).toBe(3 * 280 * 10_000);
    // A lucky spin is at least Rare (luckyFloor).
    expect(tierRank(result.card.tier)).toBeGreaterThanOrEqual(tierRank('rare'));
    expect(result.pack.luckMeter).toBe(0);
  });

  it('spends the return bonus on the next free spin only', async () => {
    const player = { ...veteran(), returnLuckyPending: true };
    const paid = await spin({ player });
    expect(paid.lucky).toBeNull();
    expect(paid.player.returnLuckyPending).toBe(true);

    const free = await spin({ player, packId: 'free' });
    expect(free.lucky).toBe('return');
    expect(free.player.returnLuckyPending).toBe(false);
  });

  it('plays with the card luck plus bonus points, turned into the hidden boost (D-147)', async () => {
    const player = { ...veteran(), buffs: [{ points: 10, spinsLeft: 1 }] };
    const result = await spin({ player, payment: { type: 'card', luckPoints: 30 } });
    expect(result.rolled.luckPoints).toBe(40);
    expect(result.rolled.rarePlusBoostBp).toBe(40 * config().luck.pointBp);
    expect(result.player.buffs).toEqual([]);
    // Paying from the wallet: no card luck, only the bonus.
    const wallet = await spin({ player: { ...veteran(), buffs: [{ points: 5, spinsLeft: 3 }] } });
    expect(wallet.rolled.luckPoints).toBe(5);
  });

  it('counts bad streaks on paid packs only', async () => {
    const cheap = await spin({ pack: { ...emptyPackCounters(), badStreak: 2 } });
    const expected = cheap.card.balance < 100_000 ? 3 : 0;
    expect(cheap.pack.badStreak).toBe(expected);

    const free = await spin({ packId: 'free', pack: { ...emptyPackCounters(), badStreak: 2 } });
    expect(free.pack.badStreak).toBe(2);
  });

  it('re-drops a pooled card with its number and design', async () => {
    const cfg = config();
    cfg.pool.redropChanceBp = 10_000;
    const pool = poolOf({ id: 'c1', number: '9135246802468135', bankId: 'ruby', ownersCount: 2 });
    const result = await spin({ config: cfg }, 3, pool);
    expect(result.card).toMatchObject({
      source: 'pool',
      poolCardId: 'c1',
      number: '9135246802468135',
      bankId: 'ruby',
      ownersCount: 3,
    });
    expect(result.rolled.patternTarget).toBeNull();
    expect(pool.taken).toHaveLength(1);
  });

  it('generates a new number when the pool has no card of the tier', async () => {
    const cfg = config();
    cfg.pool.redropChanceBp = 10_000;
    expect((await spin({ config: cfg })).card.source).toBe('new');
  });

  it('forces Mythic for a full duplicate', async () => {
    const cfg = config();
    cfg.pool.redropChanceBp = 10_000;
    const pool = poolOf({ id: 'fd', number: '9999999999999999', bankId: 'lemon', ownersCount: 1 });
    const result = await spin({ config: cfg }, 4, pool);
    expect(result.card.tier).toBe('mythic');
    expect(result.card.patterns.map((p) => p.id)).toEqual(['full_duplicate']);
  });

  it('rejects unknown, disabled and unsold packs', async () => {
    await expect(spin({ packId: 'nope' })).rejects.toMatchObject({ reason: 'PACK_NOT_FOUND' });
    await expect(spin({ packId: 'vip' })).rejects.toMatchObject({ reason: 'PACK_DISABLED' });
    const cfg = config();
    const vip = cfg.packs.find((p) => p.id === 'vip')!;
    vip.enabled = true;
    await expect(spin({ config: cfg, packId: 'vip' })).rejects.toBeInstanceOf(SpinRejectedError);
  });

  it('is deterministic for a seed', async () => {
    const run = async () => {
      const rng = createSeededRng(2026);
      let player = emptyPlayerCounters();
      let pack = emptyPackCounters();
      const out: string[] = [];
      for (let i = 0; i < 300; i++) {
        const r = await resolveSpin(
          {
            config: config(),
            packId: 'business',
            region: 'RU',
            payment: { type: 'wallet' },
            player,
            pack,
          },
          { rng, uniqueness: alwaysFree, pool: emptyPool },
        );
        ({ player, pack } = r);
        out.push(
          `${r.card.tier}:${r.card.number}:${r.card.balance}:${r.nearMiss?.patternId ?? '-'}`,
        );
      }
      return out;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(first.slice(0, 5)).toMatchSnapshot();
  });
});

describe('guaranteed floor', () => {
  it('lifts the tier to the guaranteed floor and beats a lower pity floor', async () => {
    for (let seed = 0; seed < 20; seed++) {
      const result = await spin(
        {
          guaranteedFloor: 'epic',
          pack: { ...emptyPackCounters(), sinceFloor: { rare: 7, epic: 0, legendary: 0 } },
        },
        seed,
      );
      expect(tierRank(result.card.tier)).toBeGreaterThanOrEqual(tierRank('epic'));
      expect(result.guaranteeApplied).toBe(true);
      expect(result.pityApplied).toBeNull();
    }
  });

  it('yields to a higher pity floor', async () => {
    const pack = { ...emptyPackCounters(), sinceFloor: { rare: 0, epic: 0, legendary: 249 } };
    const result = await spin({ packId: 'business', guaranteedFloor: 'rare', pack });
    expect(result.pityApplied).toBe('legendary');
    expect(result.guaranteeApplied).toBe(false);
  });
});

describe('level scaling of the free pack', () => {
  it('gives bigger free cards to higher levels, never paid ones', async () => {
    const low = await spin({ packId: 'free', playerLevel: 1 }, 5);
    const high = await spin({ packId: 'free', playerLevel: 11 }, 5);
    expect(high.card.baseLimit).toBe(Math.floor((low.card.baseLimit * 10_300) / 10_000));
    const paidLow = await spin({ playerLevel: 1 }, 5);
    const paidHigh = await spin({ playerLevel: 11 }, 5);
    expect(paidHigh.card.baseLimit).toBe(paidLow.card.baseLimit);
  });
});
