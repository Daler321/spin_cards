/**
 * Economy simulator CLI: `make sim ARGS="--pack basic --spins 1000000"`.
 * Without --pack every enabled pack is simulated. Exit code 1 if a paid pack leaves the RTP corridor.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  GameConfigSchema,
  type Region,
  REGIONS,
  TIERS,
} from '@spincards/shared';
import { simulate, type SimulationReport } from '../src/index.js';

const { values } = parseArgs({
  options: {
    pack: { type: 'string' },
    region: { type: 'string', default: 'RU' },
    spins: { type: 'string', default: '200000' },
    players: { type: 'string', default: '1000' },
    'card-share': { type: 'string', default: '30' },
    level: { type: 'string', default: '1' },
    seed: { type: 'string', default: '42' },
    /** D-147: bonus luck points on every spin. */
    buff: { type: 'string', default: '0' },
    /** Pay every spin with a card of this many luck points (the player's best card). */
    'card-luck': { type: 'string' },
    /** Total balance of every player in major units, for the hidden low-balance luck (D-116). */
    balance: { type: 'string' },
    config: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const region = values.region as Region;
if (!REGIONS.includes(region)) throw new Error(`--region must be one of ${REGIONS.join(', ')}`);

const config: GameConfig = values.config
  ? GameConfigSchema.parse(JSON.parse(readFileSync(values.config, 'utf8')))
  : DEFAULT_GAME_CONFIG;
const packIds = values.pack
  ? [values.pack]
  : config.packs.filter((p) => p.enabled).map((p) => p.id);

const reports: SimulationReport[] = [];
for (const packId of packIds) {
  const started = performance.now();
  const report = await simulate({
    config,
    packId,
    region,
    spins: Number(values.spins),
    players: Number(values.players),
    cardPaymentShareBp: Number(values['card-share']) * 100,
    level: Number(values.level),
    seed: Number(values.seed),
    bonusPoints: Number(values.buff),
    ...(values['card-luck'] !== undefined && { cardLuckPoints: Number(values['card-luck']) }),
    ...(values.balance !== undefined && { totalBalance: Number(values.balance) * 100 }),
  });
  reports.push(report);
  if (!values.json) print(report, performance.now() - started);
}
if (values.json) console.log(JSON.stringify(reports, null, 2));

process.exitCode = reports.some((r) => r.rtp && !r.rtp.inCorridor) ? 1 : 0;

function print(r: SimulationReport, ms: number): void {
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
  const money = (minor: number) => (minor / 100).toFixed(0);
  const lines = [
    `\n=== ${r.packId} (${r.region}/${r.currency}) price ${money(r.price)} · ${r.spins} spins · ${r.players} players · seed ${r.seed} · ${(ms / 1000).toFixed(1)}s`,
    r.rtp
      ? `RTP ${pct(r.rtp.overallBp)} (wallet ${pct(r.rtp.walletBp)}, card ${pct(r.rtp.cardBp)}) corridor ${pct(r.rtp.corridor.minBp)}–${pct(r.rtp.corridor.maxBp)} → ${r.rtp.inCorridor ? 'OK' : 'OUT'}`
      : 'RTP n/a (free pack)',
    `balance mean ${money(r.balance.mean)} · p50 ${money(r.balance.p50)} · p99 ${money(r.balance.p99)} · max ${money(r.balance.max)}`,
    `tiers   ${TIERS.map((t) => `${t} ${pct(r.tiers[t].actualBp)} (cfg ${pct(r.tiers[t].configuredBp)})`).join(' · ')}`,
    `patterns ${pct(r.patterns.patternedShareBp)} of cards · ${Object.entries(r.patterns.byId)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${id} ${n}`)
      .join(', ')}`,
    `near-miss ${pct(r.nearMiss.shareBp)} · ${Object.entries(r.nearMiss.byId)
      .map(([id, n]) => `${id} ${n}`)
      .join(', ')}`,
    `streak w/o Rare+ mean ${r.streaks.withoutRarePlus.mean.toFixed(2)} p99 ${r.streaks.withoutRarePlus.p99} max ${r.streaks.withoutRarePlus.max} · w/o Epic+ mean ${r.streaks.withoutEpicPlus.mean.toFixed(1)} p99 ${r.streaks.withoutEpicPlus.p99} max ${r.streaks.withoutEpicPlus.max}`,
    `luck lucky ${r.luck.lucky} · newbie ${r.luck.newbie} · pity rare ${r.luck.pity.rare} epic ${r.luck.pity.epic} legendary ${r.luck.pity.legendary}`,
    `pool re-drops ${r.pool.redrops} (${pct(r.pool.redropShareBp)}) · payments wallet ${r.payments.wallet} card ${r.payments.card}`,
  ];
  console.log(lines.join('\n'));
}
