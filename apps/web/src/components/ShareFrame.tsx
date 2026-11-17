import type { CardView } from '@spincards/shared';
import { type CSSProperties, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from './card/Card';

/**
 * What a shared or saved card looks like (D-114): the real card on a branded 4:3 backdrop, so the
 * picture matches the game and Telegram does not crop it. Rendered off screen and snapshotted.
 */
export const ShareFrame = forwardRef<
  HTMLDivElement,
  { card: CardView; holderName: string; bankName: string | undefined }
>(function ShareFrame({ card, holderName, bankName }, ref) {
  const { t } = useTranslation('common');
  return (
    <div ref={ref} className="share-frame">
      <div className="share-frame-brand">
        <span className="brand-card" />
        <span className="brand-name">{t('appName')}</span>
      </div>
      <div className={`aura aura--${card.tier}`}>
        <Card
          card={card}
          holderName={holderName}
          {...(bankName && { bankName })}
          animated={false}
          style={{ '--card-width': '900px' } as CSSProperties}
        />
      </div>
    </div>
  );
});
