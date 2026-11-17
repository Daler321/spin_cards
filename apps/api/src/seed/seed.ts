import { DEFAULT_GAME_CONFIG, GameConfigSchema } from '@spincards/shared';
import type { Env } from '../config/env.js';
import {
  AdminRole,
  ConfigStatus,
  type PrismaClient,
  Region,
  SeasonStatus,
} from '../generated/prisma/client.js';
import { fillMissing } from './config-upgrade.js';
import { hashPassword } from './password.js';

const CURRENCIES = [
  { code: 'RUB', symbol: '₽', decimals: 2 },
  { code: 'USD', symbol: '$', decimals: 2 },
];

/** Working names (TZ 4.3): colour association only, no real bank names or logos. */
const BANKS = [
  { id: 'lemon', region: Region.RU, color: 'yellow', name: 'Лимон Банк' },
  { id: 'azure', region: Region.RU, color: 'blue', name: 'Лазурь' },
  { id: 'ruby', region: Region.RU, color: 'red', name: 'Рубин' },
  { id: 'emerald', region: Region.RU, color: 'green', name: 'Изумруд' },
  { id: 'liberty', region: Region.US, color: 'blue', name: 'Liberty Trust' },
  { id: 'eagle', region: Region.US, color: 'red', name: 'Eagle National' },
  { id: 'evergreen', region: Region.US, color: 'green', name: 'Evergreen' },
  { id: 'frontier', region: Region.US, color: 'gold', name: 'Frontier Gold' },
];

const FLAGS = [
  { key: 'stars_enabled', enabled: false, description: 'Telegram Stars payments' },
  { key: 'near_miss_ux', enabled: true, description: 'Show the honest "almost" hint' },
  { key: 'maintenance_mode', enabled: false, description: 'Reject game actions' },
  { key: 'minigames_enabled', enabled: false, description: 'Mini-games for wallet money (D-169)' },
  {
    key: 'craft_enabled',
    enabled: false,
    description: 'Card craft and Stars upgrade (D-170, D-171)',
  },
  {
    key: 'album_income_enabled',
    enabled: false,
    description: 'Album income every 8 hours (D-172)',
  },
  {
    key: 'nick_bonus_enabled',
    enabled: false,
    description: 'Bonus for the tag in the name (D-173)',
  },
];

/** 1 USD = 90 RUB (TZ 4.1), 3% fee. Rates are rate_nano = target units per source unit × 10^9. */
const RATES = [
  { fromCurrency: 'RUB', toCurrency: 'USD', rateNano: 1_000_000_000n / 90n, feeBp: 300 },
  { fromCurrency: 'USD', toCurrency: 'RUB', rateNano: 90_000_000_000n, feeBp: 300 },
];

export interface SeedSummary {
  configVersionCreated: boolean;
  /** A new active version was created because the schema gained fields. */
  configUpgraded: boolean;
  seasonCreated: boolean;
  ratesCreated: number;
  adminCreated: boolean;
}

/** Idempotent: existing rows are kept (admin edits win), missing ones are created. */
export async function seed(prisma: PrismaClient, env: Env): Promise<SeedSummary> {
  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: currency.code }, update: {}, create: currency });
  }
  for (const [sortOrder, bank] of BANKS.entries()) {
    await prisma.bank.upsert({
      where: { id: bank.id },
      update: {},
      create: { ...bank, sortOrder, design: { palette: bank.color } },
    });
  }
  for (const [sortOrder, holder] of DEFAULT_GAME_CONFIG.holders.entries()) {
    await prisma.holder.upsert({
      where: { id: holder.id },
      update: {},
      create: { id: holder.id, sortOrder },
    });
  }
  for (const flag of FLAGS) {
    await prisma.featureFlag.upsert({ where: { key: flag.key }, update: {}, create: flag });
  }

  let ratesCreated = 0;
  for (const rate of RATES) {
    const exists = await prisma.exchangeRate.findFirst({
      where: { fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency },
    });
    if (!exists) {
      await prisma.exchangeRate.create({ data: { ...rate, changedBy: 'seed' } });
      ratesCreated++;
    }
  }

  const seasonExists = (await prisma.season.count()) > 0;
  if (!seasonExists) {
    await prisma.season.create({
      data: { name: 'Бета', startsAt: new Date(), status: SeasonStatus.active },
    });
  }

  const configExists = (await prisma.gameConfigVersion.count()) > 0;
  if (!configExists) {
    await prisma.gameConfigVersion.create({
      data: {
        payload: DEFAULT_GAME_CONFIG,
        status: ConfigStatus.active,
        comment: 'Default config (seed)',
        createdBy: 'seed',
        activatedAt: new Date(),
      },
    });
  }

  const configUpgraded = configExists && (await upgradeActiveConfig(prisma));

  let adminCreated = false;
  if (env.ADMIN_OWNER_LOGIN && env.ADMIN_OWNER_PASSWORD) {
    const exists = await prisma.adminUser.findUnique({ where: { login: env.ADMIN_OWNER_LOGIN } });
    if (!exists) {
      await prisma.adminUser.create({
        data: {
          login: env.ADMIN_OWNER_LOGIN,
          passwordHash: await hashPassword(env.ADMIN_OWNER_PASSWORD),
          role: AdminRole.owner,
        },
      });
      adminCreated = true;
    }
  }

  return {
    configVersionCreated: !configExists,
    configUpgraded,
    seasonCreated: !seasonExists,
    ratesCreated,
    adminCreated,
  };
}

/**
 * When the config schema gains fields, the active version stops validating. Its values are kept,
 * missing keys come from the defaults, and the result becomes a new active version (the old one is
 * archived), so spins keep referencing the exact config they used.
 */
async function upgradeActiveConfig(prisma: PrismaClient): Promise<boolean> {
  const active = await prisma.gameConfigVersion.findFirst({
    where: { status: ConfigStatus.active },
  });
  if (!active || GameConfigSchema.safeParse(active.payload).success) return false;

  // Added keys are filled in; a structurally incompatible config (e.g. a list turned into levels)
  // cannot be merged and is replaced by the defaults, recorded in the version comment.
  const filled = GameConfigSchema.safeParse(fillMissing(active.payload, DEFAULT_GAME_CONFIG));
  const upgraded = filled.success ? filled.data : DEFAULT_GAME_CONFIG;
  const comment = filled.success
    ? `Schema upgrade of version ${String(active.id)} (seed)`
    : `Version ${String(active.id)} is incompatible with the new schema: reset to defaults (seed)`;
  await prisma.$transaction([
    prisma.gameConfigVersion.update({
      where: { id: active.id },
      data: { status: ConfigStatus.archived },
    }),
    prisma.gameConfigVersion.create({
      data: {
        payload: upgraded,
        status: ConfigStatus.active,
        comment,
        createdBy: 'seed',
        activatedAt: new Date(),
      },
    }),
  ]);
  return true;
}
