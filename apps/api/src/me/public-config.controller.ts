import { Controller, Get } from '@nestjs/common';
import {
  type GameConfig,
  PATTERN_IDS,
  type PublicConfigResponse,
  type PublicPack,
  seasonCardDesign,
  TIERS,
} from '@spincards/shared';
import { Public } from '../auth/decorators.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TextsService } from '../texts/texts.service.js';

const STARS_FLAG = 'stars_enabled';

/** Everything the "Odds" screen and shop need; no internal economy knobs (pattern weights etc.). */
@Public()
@Controller('v1/config')
export class PublicConfigController {
  constructor(
    private readonly config: GameConfigService,
    private readonly prisma: PrismaService,
    private readonly flags: FlagsService,
    private readonly telegram: TelegramApiService,
    private readonly texts: TextsService,
    private readonly seasons: SeasonService,
  ) {}

  @Get('public')
  async publicConfig(): Promise<PublicConfigResponse> {
    const { versionId, config } = await this.config.active();
    const [craftOn, albumIncomeOn, nickBonusOn] = await Promise.all([
      this.flags.isEnabled('craft_enabled'),
      this.flags.isEnabled('album_income_enabled'),
      this.flags.isEnabled('nick_bonus_enabled'),
    ]);
    const starsEnabled =
      (await this.prisma.featureFlag.findUnique({ where: { key: STARS_FLAG } }))?.enabled ?? false;
    const paused = new Set<string>();
    for (const pack of config.packs)
      if (await this.flags.isPackPaused(pack.id)) paused.add(pack.id);
    const rates = await this.prisma.$queryRaw<
      { fromCurrency: string; toCurrency: string; rateNano: bigint; feeBp: number }[]
    >`SELECT DISTINCT ON (from_currency, to_currency)
        from_currency AS "fromCurrency", to_currency AS "toCurrency", rate_nano AS "rateNano", fee_bp AS "feeBp"
      FROM exchange_rates WHERE valid_from <= now()
      ORDER BY from_currency, to_currency, valid_from DESC`;

    return {
      // D-146: what Stars buy; null while stars_enabled is off.
      stars: starsEnabled
        ? {
            buffs: config.stars.buffs,
            freeSpins: config.stars.freeSpins,
            cardLimitReset: config.stars.cardLimitReset,
            cardExtend: config.stars.cardExtend,
            trophy: config.stars.trophy,
            wheelNow: config.stars.wheelNow,
            albumSlot: config.showcase.extraSlotStars,
            cardUpgrade: craftOn ? config.stars.cardUpgrade : null,
          }
        : null,
      configVersion: versionId,
      packs: config.packs
        .filter(
          (pack) =>
            pack.enabled &&
            !paused.has(pack.id) &&
            (starsEnabled || Object.keys(pack.prices).length > 0),
        )
        .map((pack) => publicPack(pack, config, starsEnabled)),
      tiers: TIERS.map((tier) => ({
        tier,
        lifespanHours: config.tiers[tier].lifespanHours,
        cardLuckPoints: config.tiers[tier].cardLuckPoints,
      })),
      holders: config.holders.map((h) => ({
        id: h.id,
        slots: h.slots,
        unlockLevel: h.unlockLevel,
        prices: h.prices,
        starsPrice: starsEnabled ? h.starsPrice : null,
      })),
      levels: config.levels,
      conversion: {
        ...config.conversion,
        rates: rates.map((r) => ({ ...r, rateNano: r.rateNano.toString() })),
      },
      luck: {
        meterMax: config.luck.meterMax,
        maxPoints: config.luck.maxPoints,
        numberCapPoints: config.cardLuck.numberCapPoints,
      },
      transfer: config.transfer,
      freeSpins: config.freeSpins,
      banks: await this.prisma.bank.findMany({
        select: { id: true, region: true, color: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      patterns: PATTERN_IDS.map((id) => ({
        id,
        multBp: config.patterns.byId[id].multBp,
        rarityPoints: config.patterns.byId[id].rarityPoints,
      })),
      numberMultCapBp: config.patterns.numberMultCapBp,
      cardDesign: seasonCardDesign((await this.seasons.current()).designSetId),
      lifecycle: {
        graceHours: config.lifecycle.graceHours,
        extendPrice: config.lifecycle.extendPrice,
        extendLifespanBp: config.lifecycle.extendLifespanBp,
        restoreMultBp: config.lifecycle.restoreMultBp,
      },
      daily: {
        rewards: config.daily.rewards,
        levelBonusBp: config.daily.levelBonusBp,
        levelStep: config.daily.levelStep,
      },
      rewardLevelBonusBp: config.rewardLevelBonusBp,
      chest: {
        everySpins: config.chest.everySpins,
        maxStored: config.chest.maxStored,
        levels: config.chest.levels.map((level) => ({
          level: level.level,
          upgradePrice: level.upgradePrice,
          upgradeStarsPrice: starsEnabled ? level.upgradeStarsPrice : null,
          rewards: withOdds(level.rewards),
        })),
      },
      wheel: {
        intervalHours: config.wheel.intervalHours,
        segments: withOdds(config.wheel.segments),
      },
      craft:
        craftOn && config.craft
          ? {
              cards: config.craft.cards,
              successBp: config.craft.successBp,
              fee: config.craft.fee,
            }
          : null,
      albumIncome: (albumIncomeOn && config.albumIncome) || null,
      nickBonus: (nickBonusOn && config.nickBonus) || null,
      newsUrl: config.links?.newsUrl ?? null,
      collectionLevels: config.collectionLevels,
      shop: config.shop,
      referral: {
        spinsRequired: config.referral.spinsRequired,
        levelRequired: config.referral.levelRequired,
        referrerReward: config.referral.referrerReward,
        referredReward: config.referral.referredReward,
        commission: config.referral.commission,
      },
      botUsername: await this.telegram.botUsername(),
      p2p: config.p2p,
      texts: await this.texts.miniApp(),
    };
  }
}

function publicPack(
  pack: GameConfig['packs'][number],
  config: GameConfig,
  starsEnabled: boolean,
): PublicPack {
  const total = TIERS.reduce((sum, tier) => sum + pack.tierWeights[tier], 0);
  return {
    id: pack.id,
    free: pack.free,
    prices: pack.prices,
    starsPrice: starsEnabled ? pack.starsPrice : null,
    /** Published base odds in basis points (TZ: odds are shown to every player). */
    oddsBp: Object.fromEntries(
      TIERS.map((tier) => [tier, Math.round((pack.tierWeights[tier] * 10_000) / total)]),
    ) as PublicPack['oddsBp'],
    pity: pack.pity,
    baseLimit: pack.baseLimit,
    unlockLevel: pack.unlockLevel,
    patternCapBp: config.patterns.numberMultCapBp,
  };
}

/** Replaces weights with published odds in basis points (chest and wheel odds are public). */
function withOdds<T extends { weight: number }>(
  items: readonly T[],
): (Omit<T, 'weight'> & { oddsBp: number })[] {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  return items.map(({ weight, ...rest }) => ({
    ...rest,
    oddsBp: Math.round((weight * 10_000) / total),
  }));
}
