import { TIERS } from '@spincards/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BANK_LOOKS } from '../src/components/card/banks';
import { Card, type CardData } from '../src/components/card/Card';

const base: CardData = {
  number: '9123456712349999',
  bankId: 'lemon',
  tier: 'common',
  patterns: [
    { id: 'block_ladder', start: 8, length: 4 },
    { id: 'tail_9999', start: 12, length: 4 },
  ],
  expiresAt: '2026-11-03T10:00:00Z',
  ownersCount: 3,
  balance: 123_456,
  currency: 'RUB',
};

describe('<Card>', () => {
  const banks = Object.keys(BANK_LOOKS);

  it.each(TIERS.flatMap((tier) => banks.map((bankId) => [tier, bankId] as const)))(
    'renders %s × %s',
    (tier, bankId) => {
      const { container } = render(
        <Card card={{ ...base, tier, bankId }} holderName="Аня" bankName="Банк" />,
      );
      const card = container.querySelector('.gc');
      expect(card?.classList).toContain(`gc--${tier}`);
      expect(card?.classList).toContain(`gc--bank-${bankId}`);
      expect(card?.getAttribute('style')).toContain('--bank-from');
    },
  );

  it('shows the number, holder, owners, expiry and the game-card mark', () => {
    render(<Card card={base} holderName="Аня" bankName="Лимон Банк" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('9123 4567 1234 9999');
    expect(screen.getByText('АНЯ')).toBeTruthy();
    expect(screen.getByText('3-й владелец')).toBeTruthy();
    expect(screen.getByText('03.11')).toBeTruthy();
    expect(screen.getByText('игровая карта')).toBeTruthy();
    expect(screen.getByText('Лимон Банк')).toBeTruthy();
  });

  it('highlights pattern digits', () => {
    const { container } = render(<Card card={base} holderName="Аня" />);
    expect(container.querySelectorAll('.gc-digit--pattern')).toHaveLength(8);
    expect(container.querySelectorAll('.gc-digit--plain')).toHaveLength(8);
  });

  it('can hide the balance', () => {
    const { container } = render(<Card card={base} holderName="Аня" showBalance={false} />);
    expect(container.querySelector('.gc-balance')).toBeNull();
  });
});
