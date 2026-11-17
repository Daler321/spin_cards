/**
 * Season progression simulator: `make progression` (ARGS="--players 200 --days 14 --json").
 * Plays whole seasons for a few kinds of players with the real spin engine and the economy config:
 * level, money and pack by day, when Business and Premium open, how often a player runs dry.
 *
 * Model: the player keeps the luckiest card dropped so far and pays every spin with it, topped up
 * from the wallet (D-141: that is what players do); every other card is cashed out at once. The
 * player spins the best open pack while the wallet holds `reserve` spins of it, else a cheaper
 * one, else free spins.
 * Faucets are counted at their expected value: the daily reward, the wheel (once per session),
 * chests (one per everySpins), daily quests (a share of them). Achievements and season quests are
 * left out, so real players progress a little faster than this.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  GameConfigSchema,
  type Region,
  type Tier,
  tierRank,
  TIERS,
} from '@spincards/shared';
import {
  cardLuckPoints,
  cashoutFeeBp,
  cashoutPayout,
  createSeededRng,
  emptyPackCounters,
  emptyPlayerCounters,
  levelForExp,
  type PackCounters,
  type PlayerCounters,
  resolveSpin,
} from '../src/index.js';

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '100' },
    days: { type: 'string', default: '14' },
    region: { type: 'string', default: 'RU' },
    seed: { type: 'string', default: '7' },
    config: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const config: GameConfig = values.config
  ? GameConfigSchema.parse(JSON.parse(readFileSync(values.config, 'utf8')))
  : DEFAULT_GAME_CONFIG;
const region = values.region as Region;
const currency = config.regions[region].currency;
const DAYS = Number(values.days);

interface Profile {
  id: string;
  /** Cards a day (a ×4 spin is four). */
  spinsPerDay: number;
  sessionsPerDay: number;
  /** Daily quests completed a day. */
  questsPerDay: number;
}

const PROFILES: Profile[] = [
  { id: 'casual', spinsPerDay: 60, sessionsPerDay: 2, questsPerDay: 2 },
  { id: 'regular', spinsPerDay: 250, sessionsPerDay: 3, questsPerDay: 4 },
  { id: 'active', spinsPerDay: 600, sessionsPerDay: 5, questsPerDay: 5 },
  { id: 'grinder', spinsPerDay: 1500, sessionsPerDay: 6, questsPerDay: 5 },
];
/** Spins of a pack the wallet must hold before the player moves up to it. */
const RESERVE = 5;

const money = (m: Partial<Record<string, number>> | undefined) => m?.[currency] ?? 0;
const scaled = (amount: number, level: number) =>
  Math.floor(amount * (1 + ((level - 1) * config.rewardLevelBonusBp) / 10_000));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function expected<T extends { weight: number }>(items: T[], value: (item: T) => number): number {
  const total = items.reduce((s, i) => s + i.weight, 0);
  return items.reduce((s, i) => s + (i.weight / total) * value(i), 0);
}

const wheelMoney = expected(config.wheel.segments, (s) => money(s.money));
const chestMoney = expected(config.chest.levels[0]?.rewards ?? [], (r) => money(r.money));
const questMoney = avg(config.quests.daily.map((q) => money(q.reward.money)));
const questExp = avg(config.quests.daily.map((q) => q.reward.exp ?? 0));
const paid = config.packs.filter((p) => p.enabled && !p.free && p.prices[currency] !== undefined);
const freePack = config.packs.find((p) => p.enabled && p.free);

interface DayRow {
  level: number;
  wallet: number;
  pack: string;
  broke: boolean;
}

interface PlayerRun {
  days: DayRow[];
  unlocked: Record<string, number | null>;
  best: Record<Tier, number>;
  /** Spins by pack over the season. */
  spins: Record<string, number>;
}

async function playSeason(profile: Profile, seed: number): Promise<PlayerRun> {
  const rng = createSeededRng(seed);
  const issued = new Set<string>();
  const ports = {
    rng,
    uniqueness: {
      isNumberFree: (n: string, cell: { bankId: string; tier: Tier }) =>
        Promise.resolve(!issued.has(`${cell.bankId}|${cell.tier}|${n}`)),
    },
    pool: { takeOldest: () => Promise.resolve(null) },
  };
  let wallet = config.startingBalance[currency] ?? 0;
  let exp = 0;
  let level = 1;
  let player: PlayerCounters = emptyPlayerCounters();
  const counters = new Map<string, PackCounters>();
  let freeSpins = config.freeSpins.maxStored;
  let bestLuck = 0;
  let spinsTotal = 0;
  const days: DayRow[] = [];
  const unlocked: Record<string, number | null> = Object.fromEntries(paid.map((p) => [p.id, null]));
  const best = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const spins: Record<string, number> = {};

  for (let day = 1; day <= DAYS; day++) {
    // Faucets of the day.
    const daily = config.daily.rewards[(day - 1) % config.daily.rewards.length];
    wallet += scaled(money(daily?.money), level);
    freeSpins += daily?.freeSpins ?? 0;
    exp += config.exp.dailyClaim;
    wallet += Math.floor(scaled(wheelMoney, level) * profile.sessionsPerDay);
    freeSpins += Math.min(profile.sessionsPerDay, Math.floor(24 / config.freeSpins.intervalHours));
    let broke = false;
    let lastPack = '-';

    for (let s = 0; s < profile.spinsPerDay; s++) {
      const open = paid.filter((p) => p.unlockLevel <= level);
      const price = (id: string) => paid.find((p) => p.id === id)?.prices[currency] ?? 0;
      const choice =
        [...open].reverse().find((p) => wallet >= (p.prices[currency] ?? 0) * RESERVE) ??
        open.find((p) => wallet >= (p.prices[currency] ?? 0));
      const pack = choice ?? (freeSpins > 0 ? freePack : undefined);
      if (!pack) {
        broke = true;
        break;
      }
      if (pack.free) freeSpins--;
      else wallet -= price(pack.id);
      lastPack = pack.id;
      spins[pack.id] = (spins[pack.id] ?? 0) + 1;
      const result = await resolveSpin(
        {
          config,
          packId: pack.id,
          region,
          payment:
            bestLuck > 0 && !pack.free
              ? { type: 'card', luckPoints: bestLuck }
              : { type: 'wallet' },
          player,
          pack: counters.get(pack.id) ?? emptyPackCounters(),
          playerLevel: level,
          totalBalance: wallet,
        },
        ports,
      );
      player = result.player;
      counters.set(pack.id, result.pack);
      issued.add(`${result.card.bankId}|${result.card.tier}|${result.card.number}`);
      bestLuck = Math.max(bestLuck, cardLuckPoints(result.card.tier, result.card.patterns, config));
      wallet += cashoutPayout(result.card.balance, cashoutFeeBp(level, config));
      exp += pack.exp + config.exp.tierBonus[result.card.tier];
      best[result.card.tier]++;
      spinsTotal++;
      if (spinsTotal % config.chest.everySpins === 0) wallet += scaled(chestMoney, level);
      // Daily quests pay out over the day.
      if (s === Math.floor(profile.spinsPerDay / 2)) {
        wallet += scaled(questMoney, level) * profile.questsPerDay;
        exp += questExp * profile.questsPerDay;
      }
      const next = levelForExp(exp, config);
      if (next !== level) {
        level = next;
        for (const p of paid)
          if (unlocked[p.id] === null && p.unlockLevel <= level) unlocked[p.id] = day;
      }
    }
    days.push({ level, wallet, pack: lastPack, broke });
  }
  return { days, unlocked, best, spins };
}

function pct(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

const players = Number(values.players);
const report: Record<string, unknown> = {};
const fmt = (minor: number) => `${Math.round(minor / 100).toLocaleString('ru-RU')} ₽`;

for (const profile of PROFILES) {
  const runs: PlayerRun[] = [];
  for (let i = 0; i < players; i++)
    runs.push(await playSeason(profile, Number(values.seed) * 100_003 + i));
  const checkpoints = [1, 2, 3, 5, 7, 10, 14].filter((d) => d <= DAYS);
  const byDay = checkpoints.map((d) => {
    const rows = runs.flatMap((r) => r.days.slice(d - 1, d));
    const levels = rows.map((r) => r.level);
    const packs = new Map<string, number>();
    for (const r of rows) packs.set(r.pack, (packs.get(r.pack) ?? 0) + 1);
    return {
      day: d,
      levelP10: pct(levels, 0.1),
      levelMedian: pct(levels, 0.5),
      levelP90: pct(levels, 0.9),
      walletMedian: pct(
        rows.map((r) => r.wallet),
        0.5,
      ),
      brokeShare: rows.filter((r) => r.broke).length / rows.length,
      pack: [...packs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-',
    };
  });
  const unlockDays = Object.fromEntries(
    paid.map((p) => {
      const daysOpen = runs.map((r) => r.unlocked[p.id]).filter((d): d is number => d !== null);
      return [
        p.id,
        {
          share: daysOpen.length / runs.length,
          medianDay: daysOpen.length ? pct(daysOpen, 0.5) : null,
        },
      ];
    }),
  );
  const drops = Object.fromEntries(
    TIERS.filter((t) => tierRank(t) >= tierRank('epic')).map((t) => [
      t,
      pct(
        runs.map((r) => r.best[t]),
        0.5,
      ),
    ]),
  );
  const totals: Record<string, number> = {};
  for (const r of runs)
    for (const [id, n] of Object.entries(r.spins)) totals[id] = (totals[id] ?? 0) + n;
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const packShare = Object.fromEntries(
    Object.entries(totals).map(([id, n]) => [id, Math.round((n / all) * 1000) / 10]),
  );
  report[profile.id] = { profile, byDay, unlockDays, drops, packShare };

  if (!values.json) {
    console.log(
      `\n== ${profile.id}: ${String(profile.spinsPerDay)} cards a day, ${String(players)} players`,
    );
    for (const row of byDay)
      console.log(
        `day ${String(row.day).padStart(2)}: level ${String(row.levelMedian).padStart(3)} ` +
          `(p10 ${String(row.levelP10)}, p90 ${String(row.levelP90)}), wallet ${fmt(row.walletMedian)}, ` +
          `pack ${row.pack}, ran dry ${String(Math.round(row.brokeShare * 100))}%`,
      );
    for (const [id, u] of Object.entries(unlockDays))
      console.log(
        `${id}: opened for ${String(Math.round(u.share * 100))}%` +
          (u.medianDay ? `, median day ${String(u.medianDay)}` : ''),
      );
    console.log(`season drops (median): ${JSON.stringify(drops)}`);
    console.log(`spins by pack, %: ${JSON.stringify(packShare)}`);
  }
}
if (values.json) console.log(JSON.stringify(report, null, 2));
