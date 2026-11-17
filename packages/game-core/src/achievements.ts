import {
  type AchievementDef,
  type Currency,
  type GameConfig,
  type PatternId,
  type Tier,
  tierRank,
} from '@spincards/shared';

/** What the player has just done or reached; only the known facts are checked (D-133). */
export interface AchievementFacts {
  cards?: readonly { tier: Tier; patterns: readonly PatternId[] }[];
  totalSpins?: number;
  level?: number;
  trophies?: number;
  quests?: number;
  /** Wallets plus live cards, in RUB minor units. */
  netWorthRub?: number;
}

/** Ids of the achievements these facts satisfy (season rank and collection are granted elsewhere). */
export function earnedAchievements(
  defs: readonly AchievementDef[],
  facts: AchievementFacts,
): string[] {
  return defs
    .filter((def) => {
      const c = def.condition;
      switch (c.type) {
        case 'card_tier':
          return facts.cards?.some((card) => tierRank(card.tier) >= tierRank(c.tier)) ?? false;
        case 'pattern':
          return (
            facts.cards?.some((card) => card.patterns.some((p) => c.patterns.includes(p))) ?? false
          );
        case 'total_spins':
          return (facts.totalSpins ?? 0) >= c.value;
        case 'level':
          return (facts.level ?? 0) >= c.value;
        case 'trophies':
          return (facts.trophies ?? 0) >= c.value;
        case 'quests':
          return (facts.quests ?? 0) >= c.value;
        case 'net_worth':
          return (facts.netWorthRub ?? 0) >= c.value;
        case 'season_rank':
        case 'season_collection':
          return false;
      }
    })
    .map((def) => def.id);
}

/** D-132: the season score: card rarity + net worth in points + level points. */
export function seasonScore(
  parts: { cardPoints: number; netWorthRub: number; level: number },
  rules: GameConfig['seasons']['score'],
): { cards: number; money: number; level: number; total: number } {
  const money = Math.floor(Math.max(0, parts.netWorthRub) / rules.rubPerPoint);
  const level = parts.level * rules.levelPoints;
  return { cards: parts.cardPoints, money, level, total: parts.cardPoints + money + level };
}

/** Extra start money of the next season for a score (capped). */
export function seasonCarryover(
  score: number,
  currency: Currency,
  rules: GameConfig['seasons']['carryover'],
): number {
  return Math.min(score * rules.perPoint[currency], rules.cap[currency]);
}

/** The medal of a final rank, if any (the narrowest bracket that covers it). */
export function seasonMedal(rank: number, medals: GameConfig['seasons']['medals']): string | null {
  return (
    [...medals].sort((a, b) => a.maxRank - b.maxRank).find((m) => rank <= m.maxRank)
      ?.achievementId ?? null
  );
}
