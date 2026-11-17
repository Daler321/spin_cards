import { CARD_DESIGNS, TIERS } from '@spincards/shared';
import type { CSSProperties } from 'react';
import { BANK_LOOKS } from '../components/card/banks';
import { Card } from '../components/card/Card';

/** Dev-only design sheet (open /#gallery): every design × tier × bank, with pattern highlights. */
export default function CardGallery() {
  const patterns = [
    { id: 'long_ladder_7' as const, start: 1, length: 7 },
    { id: 'tail_7777' as const, start: 12, length: 4 },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        padding: 16,
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      }}
    >
      {CARD_DESIGNS.flatMap((design) =>
        TIERS.flatMap((tier) =>
          Object.keys(BANK_LOOKS).map((bankId) => (
            <Card
              key={`${design}-${tier}-${bankId}`}
              card={{
                design,
                number: '9123456780527777',
                bankId,
                tier,
                patterns,
                expiresAt: '2026-11-03T10:00:00Z',
                ownersCount: 2,
                balance: 1_234_500,
                currency:
                  bankId === 'lemon' ||
                  bankId === 'azure' ||
                  bankId === 'ruby' ||
                  bankId === 'emerald'
                    ? 'RUB'
                    : 'USD',
              }}
              holderName="Аня"
              bankName={bankId}
              style={{ '--card-width': '260px' } as CSSProperties}
            />
          )),
        ),
      )}
    </div>
  );
}
