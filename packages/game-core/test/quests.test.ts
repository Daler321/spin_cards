import type { QuestDef, Tier } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import { advanceQuest, pickDailyQuests, type QuestEvent, type QuestState } from '../src/index.js';
import { createSeededRng } from '../src/seeded-rng.js';

const quest = (over: Partial<QuestState>): QuestState => ({
  metric: 'spins',
  tier: null,
  progress: 0,
  meta: {},
  ...over,
});
const card = (tier: Tier, bankId = 'ruby', patterned = false): QuestEvent => ({
  type: 'card',
  tier,
  bankId,
  patterned,
});

describe('advanceQuest (D-124)', () => {
  it('counts spins, card payments, cash-outs, holds and one-off actions', () => {
    const spin: QuestEvent = { type: 'spin', count: 4, paidWithCard: true };
    expect(advanceQuest(quest({ metric: 'spins', progress: 1 }), [spin]).progress).toBe(5);
    expect(advanceQuest(quest({ metric: 'card_spins' }), [spin]).progress).toBe(4);
    expect(
      advanceQuest(quest({ metric: 'card_spins' }), [{ ...spin, paidWithCard: false }]).progress,
    ).toBe(0);
    expect(
      advanceQuest(quest({ metric: 'cashouts' }), [{ type: 'cashout', count: 3 }]).progress,
    ).toBe(3);
    expect(advanceQuest(quest({ metric: 'holds' }), [{ type: 'hold', count: 2 }]).progress).toBe(2);
    for (const metric of ['wheel', 'chest', 'daily_claim'] as const)
      expect(advanceQuest(quest({ metric }), [{ type: metric }, spin]).progress).toBe(1);
  });

  it('counts cards from a tier up, patterned cards and the best bank', () => {
    const drops = [
      card('rare'),
      card('epic'),
      card('mythic', 'azure', true),
      card('epic', 'azure'),
    ];
    expect(advanceQuest(quest({ metric: 'cards_tier', tier: 'epic' }), drops).progress).toBe(3);
    expect(advanceQuest(quest({ metric: 'cards_patterned' }), drops).progress).toBe(1);
    const bank = advanceQuest(quest({ metric: 'cards_bank_max' }), drops);
    expect(bank).toEqual({ progress: 2, meta: { byBank: { ruby: 2, azure: 2 } } });
    // The bank counts carry over between events and progress follows the best bank.
    const more = advanceQuest({ ...quest({ metric: 'cards_bank_max' }), ...bank }, [
      card('common', 'azure'),
    ]);
    expect(more.progress).toBe(3);
  });

  it('counts a visit day once and keeps the best holder snapshot', () => {
    const visit = advanceQuest(quest({ metric: 'visit_days' }), [
      { type: 'visit', day: '2026-10-15' },
      { type: 'visit', day: '2026-10-15' },
    ]);
    expect(visit).toEqual({ progress: 1, meta: { lastDay: '2026-10-15' } });
    expect(
      advanceQuest({ ...quest({ metric: 'visit_days' }), ...visit }, [
        { type: 'visit', day: '2026-10-16' },
      ]).progress,
    ).toBe(2);
    const holder: QuestEvent = { type: 'holder', size: 3, longestHoldHours: 50 };
    expect(advanceQuest(quest({ metric: 'holder_size', progress: 5 }), [holder]).progress).toBe(5);
    expect(advanceQuest(quest({ metric: 'hold_hours' }), [holder]).progress).toBe(50);
  });
});

describe('pickDailyQuests', () => {
  const pool: QuestDef[] = [
    { id: 'a', metric: 'spins', target: 1, reward: {} },
    { id: 'b', metric: 'holds', target: 1, reward: {} },
    { id: 'c', metric: 'wheel', target: 1, reward: {} },
    { id: 'late', metric: 'chest', target: 1, minLevel: 10, reward: {} },
  ];

  it('picks different quests open at the level', () => {
    for (let seed = 0; seed < 20; seed++) {
      const picked = pickDailyQuests(createSeededRng(seed), pool, 3, 1).map((q) => q.id);
      expect(new Set(picked).size).toBe(3);
      expect(picked).not.toContain('late');
    }
    expect(pickDailyQuests(createSeededRng(1), pool, 10, 10)).toHaveLength(4);
  });
});
