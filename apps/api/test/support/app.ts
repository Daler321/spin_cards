import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { AppModule } from '../../src/app.module.js';
import { createHttpAdapter } from '../../src/common/http-adapter.js';
import type { Env } from '../../src/config/env.js';
import { type FeatureFlag, FlagsService } from '../../src/game-config/flags.service.js';
import { GameConfigService } from '../../src/game-config/game-config.service.js';
import { SeasonService } from '../../src/game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../../src/generated/prisma/client.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { GameConfig } from '@spincards/shared';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { REDIS } from '../../src/redis/redis.module.js';
import { TEST_BOT_TOKEN, testEnv } from './env.js';

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaService;
  redis: Redis;
  close: () => Promise<void>;
}

export async function createTestApp(
  overrides: Partial<Record<keyof Env, string>> = {},
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv(overrides))],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get(REDIS),
    close: () => app.close(),
  };
}

/** A random Telegram user id; test files run in parallel, so a shared counter would collide. */
export const nextTelegramId = () => randomInt(1_000_000, 2 ** 47);

export interface InitDataOptions {
  telegramId?: number;
  firstName?: string;
  startParam?: string;
  authDate?: Date;
  botToken?: string;
}

/** Builds initData signed exactly like Telegram does. */
export function signInitData(options: InitDataOptions = {}): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor((options.authDate ?? new Date()).getTime() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({
      id: options.telegramId ?? nextTelegramId(),
      first_name: options.firstName ?? 'Тест',
      language_code: 'ru',
    }),
  });
  if (options.startParam) params.set('start_param', options.startParam);
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData')
    .update(options.botToken ?? TEST_BOT_TOKEN)
    .digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheck).digest('hex'));
  return params.toString();
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  auth: { authorization: string };
}

export async function login(t: TestApp, options: InitDataOptions = {}): Promise<Session> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    payload: { initData: signInitData(options) },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const { accessToken, refreshToken } = res.json<{ accessToken: string; refreshToken: string }>();
  const me = await t.app.inject({
    url: '/v1/me',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return {
    accessToken,
    refreshToken,
    userId: me.json<{ id: string }>().id,
    auth: { authorization: `Bearer ${accessToken}` },
  };
}

export const idempotencyKey = () => `test-${randomUUID()}`;

/** Overrides the active game config for this app instance only (other test files share the DB). */
export async function patchConfig(t: TestApp, patch: (config: GameConfig) => void): Promise<void> {
  const service = t.app.get(GameConfigService);
  const { versionId, config } = await service.active();
  const patched = structuredClone(config);
  patch(patched);
  service.active = () => Promise.resolve({ versionId, config: patched });
}

/** Overrides feature flags for this app instance only. */
export function patchFlags(t: TestApp, flags: Partial<Record<FeatureFlag, boolean>>): void {
  const service = t.app.get(FlagsService);
  const original = service.isEnabled.bind(service);
  service.isEnabled = (flag) =>
    flag in flags ? Promise.resolve(flags[flag] ?? false) : original(flag);
}

/** Credits a wallet through the ledger (admin adjustment), as a test fixture. */
export async function fund(
  t: TestApp,
  userId: string,
  currency: string,
  amount: bigint,
): Promise<void> {
  const seasonId = await t.app.get(SeasonService).currentSeasonId();
  const wallet = await t.prisma.wallet.findUniqueOrThrow({
    where: { userId_currency: { userId, currency } },
  });
  await t.prisma.transaction((tx) =>
    t.app.get(LedgerService).post(
      tx,
      [
        {
          account: { type: LedgerAccountType.wallet, id: wallet.id },
          delta: amount,
          reason: LedgerReason.admin_adjust,
        },
      ],
      { seasonId },
    ),
  );
}

/** Marks the player as having played the current season (season ratings rank only them). */
export async function markPlayed(t: TestApp, userId: string): Promise<void> {
  const seasonId = await t.app.get(SeasonService).currentSeasonId();
  const existing = await t.prisma.userSeasonStat.findFirst({ where: { userId, seasonId } });
  if (!existing) await t.prisma.userSeasonStat.create({ data: { userId, seasonId } });
}

export async function post<T = Record<string, unknown>>(
  t: TestApp,
  session: Session,
  url: string,
  payload: Record<string, unknown> = {},
): Promise<{ status: number; body: T }> {
  const res = await t.app.inject({
    method: 'POST',
    url,
    headers: session.auth,
    payload: { idempotencyKey: idempotencyKey(), ...payload },
  });
  return { status: res.statusCode, body: res.json<T>() };
}

export async function get<T = Record<string, unknown>>(
  t: TestApp,
  session: Session,
  url: string,
): Promise<T> {
  return (await t.app.inject({ url, headers: session.auth })).json<T>();
}
