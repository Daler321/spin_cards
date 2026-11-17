import { type CardView, tierRank } from '@spincards/shared';
import { useReducedMotion } from 'motion/react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, numberBlocks } from '../lib/format';
import { useSeasonCardDesign } from '../lib/useCardDesign';
import { CARD_STAGGER_MS, digitTimes, randomTiers, scrambleDigits } from '../lib/reveal';

/** Closed digits, the balance and the colour change at these steps, not every frame. */
const SCRAMBLE_MS = 60;
const COLOR_MS = 140;
/** A short beat to see the cards light up before the result opens; a tap skips it. */
const REVEAL_MS = 450;
/** Colour steps drawn per card. */
const COLOR_STEPS = 24;
/** The last moments before a card stops never flash a tier above the dropped one (no staged "almost"). */
const CALM_MS = 600;

interface RevealsProps {
  results: CardView[];
  slow: boolean;
  /** Every 500th spin: golden cards with a banner (D-107). */
  milestone?: boolean;
  skipToken: number;
  onDone: () => void;
}

/**
 * D-164: every card of the batch at once. The result is already decided by the server: the cards
 * flicker through random tier colours (just before the stop never above the drop), the number opens digit by digit while closed digits and the balance run
 * random, and everything settles on the real card. One rAF loop writes text and attributes straight
 * into the DOM: React renders twice per spin (start and end), not per frame.
 */
export function Reveals({ results, slow, milestone = false, skipToken, onDone }: RevealsProps) {
  const { t } = useTranslation('game');
  const reduced = useReducedMotion();
  const cards = useRef<(CardRefs | null)[]>([]);
  const reported = useRef(false);
  const stopLoop = useRef<() => void>(() => undefined);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const plans = useMemo(
    () =>
      results.map((card, i) => {
        const colors = randomTiers(COLOR_STEPS, Math.random);
        const digits = card.number.length;
        const times = digitTimes(digits, slow || milestone);
        return {
          card,
          start: i * CARD_STAGGER_MS,
          times,
          last: times.at(-1) ?? 0,
          colors,
          balance: formatMoney(card.balance, card.currency),
        };
      }),
    [results, slow, milestone],
  );

  const report = () => {
    if (reported.current) return;
    reported.current = true;
    clearTimeout(revealTimer.current);
    onDone();
  };

  /** Puts every card on its real face; a natural end lets the glow play, a skip opens at once. */
  const settle = (skipped: boolean) => {
    stopLoop.current();
    plans.forEach((plan, i) => {
      const refs = cards.current[i];
      if (refs) showFinal(refs, plan.card, plan.balance);
    });
    if (skipped) report();
    else if (!reported.current) revealTimer.current = setTimeout(report, REVEAL_MS);
  };

  useEffect(() => {
    if (reduced) {
      settle(true);
      return;
    }
    let frame = 0;
    let lastScramble = -Infinity;
    let lastColor = -Infinity;
    const begin = performance.now();
    const random = Math.random;
    const tick = (now: number) => {
      const elapsed = now - begin;
      const scramble = elapsed - lastScramble >= SCRAMBLE_MS;
      const recolor = elapsed - lastColor >= COLOR_MS;
      if (scramble) lastScramble = elapsed;
      if (recolor) lastColor = elapsed;
      let running = false;
      for (const [i, plan] of plans.entries()) {
        const refs = cards.current[i];
        if (!refs || refs.done) continue;
        const local = elapsed - plan.start;
        running = true;
        if (local < 0) continue;
        // Open the digits whose time has come, left to right.
        while (refs.opened < plan.times.length && local >= (plan.times[refs.opened] ?? Infinity)) {
          const digit = refs.digits[refs.opened];
          if (digit) {
            digit.textContent = plan.card.number.charAt(refs.opened);
            digit.classList.add('is-open');
          }
          refs.opened += 1;
        }
        if (refs.opened >= plan.times.length) {
          showFinal(refs, plan.card, plan.balance);
          continue;
        }
        if (scramble) {
          for (const digit of refs.digits.slice(refs.opened))
            digit.textContent = String(Math.floor(random() * 10));
          refs.balance.textContent = scrambleDigits(plan.balance, random);
        }
        if (recolor && plan.colors.length > 0) {
          const step = Math.floor(local / COLOR_MS) % plan.colors.length;
          const color = plan.colors[step] ?? 'common';
          const calm = local > plan.last - CALM_MS && tierRank(color) > tierRank(plan.card.tier);
          refs.root.dataset.tier = calm ? 'common' : color;
        }
      }
      if (running) frame = requestAnimationFrame(tick);
      else settle(false);
    };
    frame = requestAnimationFrame(tick);
    stopLoop.current = () => {
      cancelAnimationFrame(frame);
    };
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(revealTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- why: the reveal runs once per result
  }, []);

  useEffect(() => {
    if (skipToken > 0) settle(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- why: react to skips only
  }, [skipToken]);

  return (
    <div
      className={`reveals reveals--${String(results.length)} ${milestone ? 'reveals--milestone' : ''}`}
    >
      {milestone && <div className="milestone-banner">{t('spin.milestone')}</div>}
      <div className="reveal-grid">
        {plans.map((plan, i) => (
          <RevealCard
            key={plan.card.id}
            card={plan.card}
            tierLabel={t(`tiers.${plan.card.tier}`)}
            refs={(refs) => {
              cards.current[i] = refs;
            }}
          />
        ))}
      </div>
      <span className="reveal-hint">{t('spin.skip')}</span>
    </div>
  );
}

interface CardRefs {
  root: HTMLDivElement;
  digits: HTMLSpanElement[];
  balance: HTMLSpanElement;
  tier: HTMLSpanElement;
  tierLabel: string;
  /** Digits already open. */
  opened: number;
  done: boolean;
}

function showFinal(refs: CardRefs, card: CardView, balance: string) {
  if (refs.done) return;
  refs.done = true;
  refs.digits.forEach((digit, k) => {
    digit.textContent = card.number.charAt(k);
    digit.classList.add('is-open');
  });
  refs.balance.textContent = balance;
  refs.tier.textContent = refs.tierLabel;
  refs.root.dataset.tier = card.tier;
  refs.root.classList.add('is-done');
}

/** A light card face (no <Card>: no blend layers, no shadows while it flickers); rendered once. */
const RevealCard = memo(function RevealCard({
  card,
  tierLabel,
  refs,
}: {
  card: CardView;
  tierLabel: string;
  refs: (refs: CardRefs | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const balance = useRef<HTMLSpanElement>(null);
  const tier = useRef<HTMLSpanElement>(null);
  const digits = useRef<HTMLSpanElement[]>([]);
  const blocks = numberBlocks(card.number);
  const design = useSeasonCardDesign();

  useEffect(() => {
    if (!root.current || !balance.current || !tier.current) return;
    refs({
      root: root.current,
      digits: digits.current,
      balance: balance.current,
      tier: tier.current,
      tierLabel,
      opened: 0,
      done: false,
    });
    return () => {
      refs(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- why: the DOM nodes live as long as the card
  }, []);

  return (
    <div className="reveal-cell">
      {/* The loop owns data-tier, the classes and the text below: React renders them once. */}
      <div ref={root} className={`rv-card rv-card--${design}`} data-tier="common">
        <span className="rv-chip" />
        <span className="rv-tier" ref={tier} />
        <span className="rv-balance" ref={balance}>
          {formatMoney(0, card.currency)}
        </span>
        <span className="rv-number" aria-hidden="true">
          {blocks.map((block, b) => (
            <span key={b} className="rv-block">
              {Array.from(block).map((_, d) => {
                const k = b * 4 + d;
                return (
                  <span
                    key={k}
                    className="rv-digit"
                    ref={(el) => {
                      if (el) digits.current[k] = el;
                    }}
                  >
                    0
                  </span>
                );
              })}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
});
