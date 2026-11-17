import type { CardView, Tier } from '@spincards/shared';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatExpiry, formatMoney, numberBlocks } from '../../lib/format';
import { digitMarks } from '../../lib/patterns';
import { useCardDesign } from '../../lib/useCardDesign';
import { bankLook } from './banks';
import './card.css';
import './card-emerald.css';

export type CardData = Pick<
  CardView,
  'number' | 'bankId' | 'tier' | 'patterns' | 'expiresAt' | 'ownersCount' | 'balance' | 'currency'
> &
  Partial<Pick<CardView, 'design'>>;

interface CardProps {
  card: CardData;
  holderName: string;
  bankName?: string;
  /** Hide the balance (e.g. in the spinning ribbon). */
  showBalance?: boolean;
  className?: string;
  /** Pointer tilt (on the result screen). */
  style?: CSSProperties;
  /**
   * Animated sheen/hologram and pulsing digits. Off in lists (holder grid, fan, ribbon): dozens of
   * animated blend layers make low-end phones stutter.
   */
  animated?: boolean;
}

/**
 * Game card: tier material over bank palette and pattern, chip, number with highlighted patterns,
 * holder name, expiry, tier plate and the "game card" mark. Pure CSS/SVG. The season's design
 * (D-168) is a class: `classic` is card.css alone, `emerald` adds card-emerald.css on top.
 */
export const Card = memo(CardFace);

function CardFace({
  card,
  holderName,
  bankName,
  showBalance = true,
  className = '',
  style,
  animated = true,
}: CardProps) {
  const { t } = useTranslation('game');
  const look = bankLook(card.bankId);
  const design = useCardDesign(card.design);
  const marks = digitMarks(card.patterns, card.number.length);
  const blocks = numberBlocks(card.number);

  return (
    <div
      className={`gc gc--d-${design} gc--${card.tier} gc--bank-${card.bankId} ${animated ? '' : 'gc--static'} ${className}`}
      data-tier={card.tier}
      style={
        {
          '--bank-from': look.from,
          '--bank-to': look.to,
          '--bank-ink': look.ink,
          '--bank-hl': look.highlight,
          '--pattern': look.pattern,
          ...style,
        } as CSSProperties
      }
      role="img"
      aria-label={`${t(`tiers.${card.tier}`)} ${bankName ?? ''} ${blocks.join(' ')}`}
    >
      <div className="gc-body" />
      <div className="gc-pattern" />
      <div className="gc-material" />
      <div className="gc-sheen" />

      <div className="gc-top">
        <div className="gc-bank">
          <look.Logo />
          {bankName && <span className="gc-bank-name">{bankName}</span>}
        </div>
        <TierPlate tier={card.tier} label={t(`tiers.${card.tier}`)} />
      </div>

      <div className="gc-middle">
        <Chip />
        {showBalance && (
          <div className="gc-balance">{formatMoney(card.balance, card.currency)}</div>
        )}
      </div>

      <div className="gc-number" aria-hidden="true">
        {blocks.map((block, b) => (
          <span key={b} className="gc-block">
            {Array.from(block).map((digit, i) => {
              const index = b * 4 + i;
              return (
                <span key={index} className={`gc-digit gc-digit--${marks[index] ?? 'plain'}`}>
                  {digit}
                </span>
              );
            })}
          </span>
        ))}
      </div>

      <div className="gc-bottom">
        <div className="gc-holder">
          <span className="gc-holder-name">{holderName.toUpperCase()}</span>
          <span className="gc-owner">{t('card.owner', { count: card.ownersCount })}</span>
        </div>
        <div className="gc-expiry">
          <span className="gc-expiry-label">{t('card.validThru')}</span>
          <span>{formatExpiry(card.expiresAt)}</span>
        </div>
      </div>
      <div className="gc-mark">{t('card.gameCard')}</div>
    </div>
  );
}

function TierPlate({ tier, label }: { tier: Tier; label: string }) {
  return <span className={`gc-tier gc-tier--${tier}`}>{label}</span>;
}

function Chip() {
  return (
    // Colours as attributes, not CSS: the share snapshot does not carry styles into SVG children.
    <svg className="gc-chip" viewBox="0 0 40 30" aria-hidden="true">
      <rect x="0.5" y="0.5" width="39" height="29" rx="5" fill="#e7c66b" stroke="#9a7a24" />
      <path
        d="M0 10h12v10H0M40 10H28v10h12M12 0v30M28 0v30M12 15h16"
        fill="none"
        stroke="#9a7a24"
        strokeWidth="1.2"
      />
    </svg>
  );
}
