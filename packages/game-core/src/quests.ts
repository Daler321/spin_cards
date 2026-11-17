import { type QuestDef, type QuestMetric, type Tier, tierRank } from '@spincards/shared';
import type { Rng } from './ports.js';

/** What happened in the game, as quests see it (D-124). */
export type QuestEvent =
  | { type: 'spin'; count: number; paidWithCard: boolean }
  | { type: 'card'; tier: Tier; bankId: string; patterned: boolean }
  | { type: 'cashout'; count: number }
  | { type: 'hold'; count: number }
  | { type: 'wheel' }
  | { type: 'chest' }
  | { type: 'daily_claim' }
  | { type: 'visit'; day: string }
  /** Measured from the holder: cards held now and the longest current hold in hours. */
  | { type: 'holder'; size: number; longestHoldHours: number };

export interface QuestState {
  metric: QuestMetric;
  tier: Tier | null;
  progress: number;
  meta: QuestMeta;
}

export interface QuestMeta {
  /** cards_bank_max: cards per bank. */
  byBank?: Record<string, number>;
  /** visit_days: the last day counted. */
  lastDay?: string;
}

/** The quest after these events; progress only grows (snapshots keep their best value). */
export function advanceQuest(
  quest: QuestState,
  events: readonly QuestEvent[],
): { progress: number; meta: QuestMeta } {
  let progress = quest.progress;
  const meta: QuestMeta = {
    ...quest.meta,
    ...(quest.meta.byBank && { byBank: { ...quest.meta.byBank } }),
  };
  for (const event of events) {
    switch (quest.metric) {
      case 'spins':
        if (event.type === 'spin') progress += event.count;
        break;
      case 'card_spins':
        if (event.type === 'spin' && event.paidWithCard) progress += event.count;
        break;
      case 'cards_tier':
        if (event.type === 'card' && tierRank(event.tier) >= tierRank(quest.tier ?? 'common'))
          progress += 1;
        break;
      case 'cards_bank_max':
        if (event.type === 'card') {
          meta.byBank ??= {};
          meta.byBank[event.bankId] = (meta.byBank[event.bankId] ?? 0) + 1;
          progress = Math.max(progress, meta.byBank[event.bankId] ?? 0);
        }
        break;
      case 'cards_patterned':
        if (event.type === 'card' && event.patterned) progress += 1;
        break;
      case 'cashouts':
        if (event.type === 'cashout') progress += event.count;
        break;
      case 'holds':
        if (event.type === 'hold') progress += event.count;
        break;
      case 'wheel':
      case 'chest':
      case 'daily_claim':
        if (event.type === quest.metric) progress += 1;
        break;
      case 'visit_days':
        if (event.type === 'visit' && meta.lastDay !== event.day) {
          progress += 1;
          meta.lastDay = event.day;
        }
        break;
      case 'holder_size':
        if (event.type === 'holder') progress = Math.max(progress, event.size);
        break;
      case 'hold_hours':
        if (event.type === 'holder') progress = Math.max(progress, event.longestHoldHours);
        break;
    }
  }
  return { progress, meta };
}

/** `count` different daily quests open at this level, chosen at random. */
export function pickDailyQuests(
  rng: Rng,
  pool: readonly QuestDef[],
  count: number,
  level: number,
): QuestDef[] {
  const open = pool.filter((q) => (q.minLevel ?? 1) <= level);
  const picked: QuestDef[] = [];
  while (picked.length < count && open.length > 0) {
    const [quest] = open.splice(rng.int(0, open.length), 1);
    if (quest) picked.push(quest);
  }
  return picked;
}
