/**
 * The friendly config form: the parameters people tune most, grouped, with units. Labels and hints
 * live in i18n under `cfg.<section>.<key>`; the rest of the config stays in the JSON editor.
 */
export type FieldKind = 'int' | 'percent' | 'multiplier' | 'money' | 'bool' | 'tier';

export interface ConfigField {
  key: string;
  path: (string | number)[];
  kind: FieldKind;
  /** For money: the currency of the value. */
  currency?: string;
}

export interface ConfigSection {
  id: string;
  fields: ConfigField[];
}

const f = (key: string, path: string, kind: FieldKind, currency?: string): ConfigField => ({
  key,
  path: path.split('.'),
  kind,
  ...(currency && { currency }),
});

export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: 'luck',
    fields: [
      f('meterMax', 'luck.meterMax', 'int'),
      f('luckyMult', 'luck.luckyEpicPlusMultBp', 'multiplier'),
      f('luckyFloor', 'luck.luckyFloor', 'tier'),
      f('milestoneEvery', 'luck.milestone.everySpins', 'int'),
      f('milestoneFloor', 'luck.milestone.floor', 'tier'),
      f('maxPoints', 'luck.maxPoints', 'int'),
      f('pointBp', 'luck.pointBp', 'percent'),
      f('boostCap', 'luck.boostCapBp', 'percent'),
      f('hiddenBelowRub', 'luck.hidden.lowBalanceBelow.RUB', 'money', 'RUB'),
      f('hiddenBelowUsd', 'luck.hidden.lowBalanceBelow.USD', 'money', 'USD'),
      f('hiddenLowBoost', 'luck.hidden.lowBalanceBoostBp', 'percent'),
      f('hiddenNewbieSpins', 'luck.hidden.newbieSpins', 'int'),
      f('hiddenNewbieBoost', 'luck.hidden.newbieBoostBp', 'percent'),
      f('rarityPerPoint', 'cardLuck.pointsPerPatternPoint', 'int'),
      f('rarityCap', 'cardLuck.numberCapPoints', 'int'),
      f('redrop', 'pool.redropChanceBp', 'percent'),
    ],
  },
  {
    id: 'bonuses',
    fields: [
      f('chestEvery', 'chest.everySpins', 'int'),
      f('chestMax', 'chest.maxStored', 'int'),
      f('freeInterval', 'freeSpins.intervalHours', 'int'),
      f('freeMax', 'freeSpins.maxStored', 'int'),
      f('rewardLevel', 'rewardLevelBonusBp', 'percent'),
      f('dailyExp', 'exp.dailyClaim', 'int'),
    ],
  },
  {
    id: 'fees',
    fields: [
      f('cashoutBase', 'cashout.baseFeeBp', 'percent'),
      f('cashoutPerLevel', 'cashout.feeReductionPerLevelBp', 'percent'),
      f('cashoutMin', 'cashout.minFeeBp', 'percent'),
      f('cardToCard', 'transfer.cardToCardFeeBp', 'percent'),
      f('convertLimitRub', 'conversion.dailyLimit.RUB', 'money', 'RUB'),
      f('convertLimitUsd', 'conversion.dailyLimit.USD', 'money', 'USD'),
      f('startRub', 'startingBalance.RUB', 'money', 'RUB'),
      f('extendRub', 'lifecycle.extendPrice.base.RUB', 'money', 'RUB'),
      f('extendUsd', 'lifecycle.extendPrice.base.USD', 'money', 'USD'),
      f('extendGrowth', 'lifecycle.extendPrice.tierGrowthBp', 'multiplier'),
      f('extendRarity', 'lifecycle.extendPrice.rarityPointBp', 'percent'),
      f('restoreMult', 'lifecycle.restoreMultBp', 'multiplier'),
      f('expiredFee', 'lifecycle.expiredCashoutFeeBp', 'percent'),
      f('grace', 'lifecycle.graceHours', 'int'),
    ],
  },
  {
    id: 'referral',
    fields: [
      f('spins', 'referral.spinsRequired', 'int'),
      f('level', 'referral.levelRequired', 'int'),
      f('welcomeRub', 'referral.referredReward.RUB', 'money', 'RUB'),
      f('welcomeUsd', 'referral.referredReward.USD', 'money', 'USD'),
      f('share', 'referral.commission.shareBp', 'percent'),
      f('days', 'referral.commission.days', 'int'),
      f('dailyLimit', 'referral.dailyLimit', 'int'),
      f('capReferralRub', 'referral.commission.capPerReferral.RUB', 'money', 'RUB'),
      f('capReferralUsd', 'referral.commission.capPerReferral.USD', 'money', 'USD'),
      f('capDayRub', 'referral.commission.dailyCapPerReferrer.RUB', 'money', 'RUB'),
      f('capDayUsd', 'referral.commission.dailyCapPerReferrer.USD', 'money', 'USD'),
      f('fraudSpins', 'antifraud.spinsPerHour', 'int'),
      f('fraudReferrals', 'antifraud.referralsPerDay', 'int'),
      f('fraudIp', 'antifraud.sharedIpUsers', 'int'),
      f('fraudP2p', 'antifraud.p2pSendersPerDay', 'int'),
      f('p2pLevel', 'p2p.minLevel', 'int'),
      f('p2pFee', 'p2p.feeBp', 'percent'),
      f('p2pLimitRub', 'p2p.dailyLimit.RUB', 'money', 'RUB'),
      f('p2pLimitUsd', 'p2p.dailyLimit.USD', 'money', 'USD'),
    ],
  },
  {
    id: 'safeguards',
    fields: [
      f('emissionRub', 'safeguards.dailyEmission.RUB', 'money', 'RUB'),
      f('emissionUsd', 'safeguards.dailyEmission.USD', 'money', 'USD'),
      f('rtpMin', 'safeguards.rtp.minBp', 'percent'),
      f('rtpMax', 'safeguards.rtp.maxBp', 'percent'),
      f('rtpSpins', 'safeguards.rtp.minSpins', 'int'),
      f('rtpWindow', 'safeguards.rtp.windowMinutes', 'int'),
      f('autoPause', 'safeguards.rtp.autoPause', 'bool'),
      f('corridorMin', 'simulation.rtpCorridor.minBp', 'percent'),
      f('corridorMax', 'simulation.rtpCorridor.maxBp', 'percent'),
    ],
  },
  // D-169: shown only for versions that have mini-games (the section is optional in the schema).
  {
    id: 'minigames',
    fields: [
      f('maxBetShare', 'minigames.maxBetShareBp', 'percent'),
      f('minBetRub', 'minigames.minBet.RUB', 'money', 'RUB'),
      f('minBetUsd', 'minigames.minBet.USD', 'money', 'USD'),
      f('minesEdge', 'minigames.mines.houseEdgeBp', 'percent'),
      f('minesBonus', 'minigames.mines.bonusBp', 'percent'),
      f('plinkoBalls', 'minigames.plinko.maxBalls', 'int'),
      f('coinPayout', 'minigames.coinflip.payoutBp', 'multiplier'),
      f('blackjackPayout', 'minigames.blackjack.blackjackPayoutBp', 'multiplier'),
      f('blackjackDecks', 'minigames.blackjack.decks', 'int'),
    ],
  },
  // D-170..D-173: optional sections as well; flags open the features.
  {
    id: 'craft',
    fields: [
      f('cards', 'craft.cards', 'int'),
      ...(['common', 'rare', 'epic', 'legendary'] as const).flatMap((tier) => [
        f(`${tier}Chance`, `craft.successBp.${tier}`, 'percent'),
        f(`${tier}FeeRub`, `craft.fee.${tier}.RUB`, 'money', 'RUB'),
      ]),
      f('upgradeCommon', 'stars.cardUpgrade.common', 'int'),
      f('upgradeRare', 'stars.cardUpgrade.rare', 'int'),
      f('upgradeEpic', 'stars.cardUpgrade.epic', 'int'),
      f('upgradeLegendary', 'stars.cardUpgrade.legendary', 'int'),
    ],
  },
  {
    id: 'income',
    fields: [
      f('albumHours', 'albumIncome.intervalHours', 'int'),
      ...(['common', 'rare', 'epic', 'legendary', 'mythic'] as const).map((tier) =>
        f(`album_${tier}`, `albumIncome.perTier.${tier}.RUB`, 'money', 'RUB'),
      ),
      f('nickCheckHours', 'nickBonus.checkHours', 'int'),
      f('nickClaimHours', 'nickBonus.claimHours', 'int'),
      f('nickRewardRub', 'nickBonus.reward.money.RUB', 'money', 'RUB'),
      f('nickFreeSpins', 'nickBonus.reward.freeSpins', 'int'),
    ],
  },
];

export function readPath(obj: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
    obj,
  );
}

export function writePath<T>(obj: T, path: (string | number)[], value: unknown): T {
  const copy = structuredClone(obj);
  let node = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[path.at(-1) as string] = value;
  return copy;
}

/** Stored value -> what the form shows (basis points as %, minor units as ₽/$, bp as ×). */
export function toDisplay(kind: FieldKind, value: unknown): string {
  if (kind === 'bool') return value === true ? 'true' : 'false';
  if (kind === 'tier') return typeof value === 'string' ? value : '';
  const n = Number(value ?? 0);
  if (kind === 'percent') return String(n / 100);
  if (kind === 'multiplier') return String(n / 10_000);
  if (kind === 'money') return String(n / 100);
  return String(n);
}

/** Form input -> stored value (null when the input is not a valid number). */
export function fromDisplay(kind: FieldKind, input: string): number | null {
  const n = Number(input.replace(',', '.'));
  if (input.trim() === '' || !Number.isFinite(n) || n < 0) return null;
  if (kind === 'percent' || kind === 'money') return Math.round(n * 100);
  if (kind === 'multiplier') return Math.round(n * 10_000);
  return Math.round(n);
}
