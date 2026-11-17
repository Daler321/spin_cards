import type { PatternMatchView } from '@spincards/shared';

export type DigitMark = 'plain' | 'pattern' | 'ladder';

/** Per-digit highlight: long ladders get the chain style, other patterns the glow. */
export function digitMarks(patterns: readonly PatternMatchView[], length = 16): DigitMark[] {
  const marks: DigitMark[] = Array.from({ length }, () => 'plain');
  for (const p of patterns) {
    const mark: DigitMark = p.id.startsWith('long_ladder') ? 'ladder' : 'pattern';
    for (let i = p.start; i < p.start + p.length && i < length; i++) {
      if (marks[i] !== 'ladder') marks[i] = mark;
    }
  }
  return marks;
}
