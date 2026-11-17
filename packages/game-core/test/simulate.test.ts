import { describe, expect, it } from 'vitest';
import { simulate, type SimulationOptions } from '../src/index.js';
import { config } from './helpers.js';

const options = (overrides: Partial<SimulationOptions> = {}): SimulationOptions => ({
  config: config(),
  packId: 'basic',
  region: 'RU',
  spins: 3000,
  players: 20,
  cardPaymentShareBp: 5000,
  level: 1,
  seed: 1,
  ...overrides,
});

describe('simulate', () => {
  it('is deterministic for a seed', async () => {
    expect(await simulate(options())).toEqual(await simulate(options()));
  });

  it('accounts for every spin', async () => {
    const report = await simulate(options());
    const tierTotal = Object.values(report.tiers).reduce((sum, t) => sum + t.count, 0);
    expect(tierTotal).toBe(3000);
    expect(report.payments.wallet + report.payments.card).toBe(3000);
    expect(report.payments.card).toBeGreaterThan(0);
    expect(report.luck.newbie).toBe(20 * 5);
    expect(report.tiers.common.configuredBp).toBe(8500);
    expect(report.streaks.withoutRarePlus.max).toBeLessThan(8);
    expect(report.balance.p99).toBeGreaterThanOrEqual(report.balance.p50);
  });

  it('reports RTP against the corridor', async () => {
    const report = await simulate(options());
    expect(report.rtp?.overallBp).toBeGreaterThan(0);

    const strict = config();
    strict.simulation.rtpCorridor = { minBp: 0, maxBp: 1 };
    expect((await simulate(options({ config: strict }))).rtp?.inCorridor).toBe(false);
  });

  it('pays more to players below the hidden balance threshold (D-116)', async () => {
    const [rich, poor] = await Promise.all([
      simulate(options({ spins: 10_000 })),
      simulate(options({ spins: 10_000, totalBalance: 0 })),
    ]);
    expect(poor.tiers.common.count).toBeLessThan(rich.tiers.common.count);
    expect(poor.rtp?.overallBp ?? 0).toBeGreaterThan(rich.rtp?.overallBp ?? 0);
  }, 30_000);

  it('skips the newbie window when players start with spins', async () => {
    const report = await simulate(options({ startSpins: 20 }));
    expect(report.luck.newbie).toBe(0);
  });

  it('re-drops pooled cards', async () => {
    expect((await simulate(options())).pool.redrops).toBeGreaterThan(0);
  });

  it('has no RTP for a free pack', async () => {
    const report = await simulate(options({ packId: 'free' }));
    expect(report.rtp).toBeNull();
    expect(report.payments.card).toBe(0);
  });

  it('rejects an unknown pack', async () => {
    await expect(simulate(options({ packId: 'nope' }))).rejects.toThrow(RangeError);
  });
});
