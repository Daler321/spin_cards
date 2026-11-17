import { describe, expect, it } from 'vitest';
import { craftReturns, createSeededRng, forgeCard, resolveCraft } from '../src/index.js';
import { alwaysFree, config } from './helpers.js';

describe('craft (D-170)', () => {
  it('forges a card of the asked tier, valued like a dropped one', async () => {
    const cfg = config();
    const card = await forgeCard(cfg, 'RU', 'epic', 100_000, {
      rng: createSeededRng(1),
      uniqueness: alwaysFree,
    });
    expect(card.number).toMatch(/^9\d{15}$/);
    expect(card.currency).toBe('RUB');
    if (card.tier === 'epic') expect(card.balance).toBeGreaterThanOrEqual(300_000);
    expect(card.lifespanHours).toBe(cfg.tiers[card.tier].lifespanHours);
  });

  it('goes one tier up about successBp of the time, else stays', async () => {
    const cfg = config();
    const craft = cfg.craft;
    if (!craft) throw new Error('no craft');
    const rng = createSeededRng(7);
    let up = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i++) {
      const out = await resolveCraft(cfg, craft, 'RU', 'rare', { rng, uniqueness: alwaysFree });
      if (out.success) {
        up++;
        expect(['epic', 'mythic']).toContain(out.card.tier);
      } else expect(['rare', 'mythic']).toContain(out.card.tier);
    }
    expect(up / runs).toBeGreaterThan(craft.successBp.rare / 10_000 - 0.04);
    expect(up / runs).toBeLessThan(craft.successBp.rare / 10_000 + 0.04);
  });

  it('keeps the default craft return in the corridor', async () => {
    const cfg = config();
    const returns = await craftReturns(cfg, createSeededRng(3), 3000);
    expect(returns).toHaveLength(8);
    for (const r of returns) {
      expect(r.returnBp).toBeGreaterThanOrEqual(cfg.simulation.rtpCorridor.minBp);
      expect(r.returnBp).toBeLessThanOrEqual(cfg.simulation.rtpCorridor.maxBp);
    }
  });
});
