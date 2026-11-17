import { randomInt } from 'node:crypto';
import type { SpinResponse } from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AntifraudService } from '../src/antifraud/antifraud.service.js';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { createTestApp, login, post, type TestApp } from './support/app.js';

describe('antifraud signals (D-119)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    // This app instance only: one spin an hour is already "fast".
    const configs = t.app.get(GameConfigService);
    const active = configs.active.bind(configs);
    configs.active = async () => {
      const current = await active();
      return {
        ...current,
        config: { ...current.config, antifraud: { ...current.config.antifraud, spinsPerHour: 1 } },
      };
    };
  });
  afterAll(() => t.close());

  it('lists players behind one IP and fast spinners, without storing the address', async () => {
    const antifraud = t.app.get(AntifraudService);
    const ip = `10.${String(randomInt(255))}.${String(randomInt(255))}.${String(randomInt(255))}`;
    const players = await Promise.all([login(t), login(t), login(t), login(t)]);
    for (const p of players) await antifraud.recordLogin(p.userId, ip);

    const [spinner] = players;
    const spin = await post<SpinResponse>(t, spinner, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(spin.status).toBe(200);

    const list = await antifraud.suspicious();
    const mine = list.filter((e) => players.some((p) => p.userId === e.userId));
    expect(mine).toHaveLength(4);
    for (const entry of mine)
      expect(entry.signals).toContainEqual({
        kind: 'sharedIp',
        value: expect.any(Number) as number,
      });
    expect(mine.find((e) => e.userId === spinner.userId)?.signals).toContainEqual({
      kind: 'spins',
      value: 1,
    });

    const keys = await t.redis.keys('fraud:ip:*');
    expect(keys.some((k) => k.includes(ip))).toBe(false);
  });
});
