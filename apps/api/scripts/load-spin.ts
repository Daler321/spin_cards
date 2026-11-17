/**
 * Load test of POST /v1/spin (TZ M3: >= 100 rps locally without breaking balances or uniqueness).
 *
 * Starts its own api instance on the test database (spincards_test) with rate limits lifted, signs
 * in N players, funds them through the ledger and runs "spin -> cash out" loops over real HTTP.
 * Afterwards it checks that every balance equals its ledger sum and no live card number repeats.
 * Exit code 1 if the target rps is missed or an invariant breaks.
 *
 *   make load-spin ARGS="--users 50 --seconds 30 --target 100"
 *   make load-spin ARGS="--processes 4 ..."   the api as a separate cluster (as in production),
 *                                             so the load generator does not share its CPU
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from '../src/app.module.js';
import { createHttpAdapter } from '../src/common/http-adapter.js';
import { loadEnv } from '../src/config/env.js';
import { SeasonService } from '../src/game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../src/generated/prisma/client.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const { values } = parseArgs({
  options: {
    users: { type: 'string', default: '50' },
    seconds: { type: 'string', default: '30' },
    target: { type: 'string', default: '100' },
    pack: { type: 'string', default: 'basic' },
    processes: { type: 'string', default: '0' },
  },
});
const PROCESSES = Number(values.processes);
const USERS = Number(values.users);
const SECONDS = Number(values.seconds);
const TARGET_RPS = Number(values.target);
const BOT_TOKEN = 'load-test:token';
const FUNDS = 1_000_000_000n; // 10 000 000 ₽ per player: the run must not stop on empty wallets

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required (make load-spin)');

const childEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  JWT_SECRET: 'x'.repeat(40),
};
const apiDir = new URL('..', import.meta.url).pathname;
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  cwd: apiDir,
  env: childEnv,
  stdio: 'pipe',
});
execFileSync('pnpm', ['run', '--silent', 'seed'], { cwd: apiDir, env: childEnv, stdio: 'pipe' });

const apiEnv = {
  ...childEnv,
  LOG_LEVEL: 'warn',
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  RATE_LIMIT_DEFAULT_PER_MIN: '100000000',
  RATE_LIMIT_AUTH_PER_MIN: '100000000',
  RATE_LIMIT_MUTATION_PER_MIN: '100000000',
};
const env = loadEnv(apiEnv);
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule.forRoot(env),
  createHttpAdapter(),
  {
    logger: ['warn', 'error'],
  },
);

// The api under load: this process (default) or a cluster of PROCESSES started like in production.
let base: string;
let cluster: ChildProcess | null = null;
if (PROCESSES > 0) {
  await app.init(); // only for setup: funding players through the ledger
  const port = randomInt(20_000, 40_000);
  cluster = spawn(
    'node',
    [
      '--conditions=@spincards/source',
      '--import',
      '@swc-node/register/esm-register',
      'src/main.ts',
    ],
    {
      cwd: apiDir,
      env: { ...apiEnv, API_PORT: String(port), API_PROCESSES: String(PROCESSES) },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  base = `http://127.0.0.1:${String(port)}`;
  for (let i = 0; ; i++) {
    const up = await fetch(`${base}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (up) break;
    if (i > 120) throw new Error('the api cluster did not start');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Every process must be ready, not only the first one to answer.
  await new Promise((resolve) => setTimeout(resolve, 3000));
} else {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.getHttpServer().address();
  if (address === null || typeof address === 'string')
    throw new Error('api is not listening on TCP');
  base = `http://127.0.0.1:${String(address.port)}`;
}
const prisma = app.get(PrismaService);

async function call<T>(
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as T };
}

function initData(telegramId: number): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: telegramId, first_name: 'Load' }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

// ─── Players ────────────────────────────────────────────────────────────────
const seasonId = await app.get(SeasonService).currentSeasonId();
const ledger = app.get(LedgerService);
const players = await Promise.all(
  Array.from({ length: USERS }, async () => {
    const login = await call<{ accessToken: string }>('/v1/auth/telegram', null, {
      initData: initData(randomInt(1e9, 2 ** 47)),
    });
    const me = await call<{ id: string }>('/v1/me', login.json.accessToken);
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: me.json.id, currency: 'RUB' } },
    });
    await prisma.transaction((tx) =>
      ledger.post(
        tx,
        [
          {
            account: { type: LedgerAccountType.wallet, id: wallet.id },
            delta: FUNDS,
            reason: LedgerReason.admin_adjust,
          },
        ],
        { seasonId },
      ),
    );
    // Level up so every pack is open.
    await prisma.user.update({
      where: { id: me.json.id },
      data: { level: 20, exp: 1_000_000, totalSpins: 100 },
    });
    return { token: login.json.accessToken };
  }),
);

// ─── Load ───────────────────────────────────────────────────────────────────
const latencies: number[] = [];
const errors = new Map<string, number>();
let spins = 0;
const deadline = performance.now() + SECONDS * 1000;
const started = performance.now();

await Promise.all(
  players.map(async ({ token }) => {
    while (performance.now() < deadline) {
      const t0 = performance.now();
      const res = await call<{ spins?: { card: { id: string } }[]; error?: { code: string } }>(
        '/v1/spin',
        token,
        {
          packId: values.pack,
          payment: { type: 'wallet' },
          idempotencyKey: randomUUID(),
        },
      );
      latencies.push(performance.now() - t0);
      const card = res.json.spins?.[0]?.card;
      if (res.status !== 200 || !card) {
        const code = res.json.error?.code ?? String(res.status);
        errors.set(code, (errors.get(code) ?? 0) + 1);
        continue;
      }
      spins++;
      await call(`/v1/cards/${card.id}/cashout`, token, { idempotencyKey: randomUUID() });
    }
  }),
);
const elapsed = (performance.now() - started) / 1000;

// ─── Report and invariants ──────────────────────────────────────────────────
latencies.sort((a, b) => a - b);
const pct = (q: number) =>
  latencies[Math.min(latencies.length - 1, Math.ceil(q * latencies.length) - 1)] ?? 0;
const rps = spins / elapsed;
const mismatches = await findLedgerMismatches(prisma);
const duplicates = await prisma.$queryRaw<{ n: bigint }[]>`
  SELECT count(*) AS n FROM (SELECT number FROM cards WHERE status IN ('active', 'expired')
  GROUP BY bank_id, tier, number HAVING count(*) > 1) d`;

const report = {
  users: USERS,
  apiProcesses: PROCESSES || 'in-process',
  seconds: Number(elapsed.toFixed(1)),
  spins,
  spinRps: Number(rps.toFixed(1)),
  latencyMs: {
    p50: Math.round(pct(0.5)),
    p95: Math.round(pct(0.95)),
    p99: Math.round(pct(0.99)),
    max: Math.round(pct(1)),
  },
  errors: Object.fromEntries(errors),
  ledgerMismatches: mismatches.length,
  duplicateLiveNumbers: Number(duplicates[0]?.n ?? 0n),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
cluster?.kill('SIGTERM');
await app.close();

const ok = rps >= TARGET_RPS && mismatches.length === 0 && report.duplicateLiveNumbers === 0;
process.stdout.write(
  ok ? `PASS: >= ${TARGET_RPS} rps, books balanced, numbers unique\n` : 'FAIL\n',
);
process.exitCode = ok ? 0 : 1;
