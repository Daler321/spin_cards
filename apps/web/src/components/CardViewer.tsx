import type { CardView } from '@spincards/shared';
import { animate, motion, useMotionValue } from 'motion/react';
import { type CSSProperties, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { prepareShare, shareImage, usePublicConfig } from '../api/queries';
import { downloadFile, haptics, shareMessage, shareURL } from '../app/telegram';
import { snapshotJpeg } from '../lib/cardImage';
import { errorText } from '../lib/errors';
import { referralLink } from '../lib/referral';
import { useToast } from '../state/toast';
import { Card } from './card/Card';
import { ShareFrame } from './ShareFrame';

/**
 * A dropped card up close (D-114): spin it, share it (Telegram's chat picker with the card image)
 * or save the image to the gallery.
 */
export function CardViewer({
  card,
  holderName,
  bankName,
  referralCode,
  onClose,
}: {
  card: CardView;
  holderName: string;
  bankName: string | undefined;
  referralCode: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['game', 'common']);
  const toast = useToast((s) => s.show);
  const rotate = useMotionValue(0);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const last4 = card.number.slice(-4);
  const tier = t(`tiers.${card.tier}`);

  const frame = useRef<HTMLDivElement>(null);
  const bot = usePublicConfig().data?.botUsername ?? '';

  const upload = async () => {
    if (!frame.current) throw new Error('share frame is not ready');
    return shareImage(card.id, await snapshotJpeg(frame.current));
  };

  const run = (kind: 'share' | 'save', action: () => Promise<void>) => {
    setBusy(kind);
    action()
      .then(() => {
        haptics.notify('success');
      })
      .catch((e: unknown) => {
        haptics.notify('error');
        toast(errorText(t, e), 'error');
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const share = () => {
    run('share', async () => {
      const { token, url } = await upload();
      const link = bot ? referralLink(bot, referralCode) : '';
      const text = t('viewer.caption', { tier, last4 });
      const linkText = t('viewer.linkText');
      try {
        // The link hides under linkText in the message (HTML caption built by the server).
        const { preparedMessageId } = await prepareShare(token, text, link, linkText);
        if (await shareMessage(preparedMessageId)) return;
      } catch {
        // Older Telegram or the bot cannot prepare messages: share a link instead.
      }
      shareURL(link || url, text);
    });
  };

  const save = () => {
    run('save', async () => {
      const { url } = await upload();
      await downloadFile(url, `spincards-${last4}.jpg`);
    });
  };

  const spin = () => {
    haptics.impact('medium');
    void animate(rotate, rotate.get() + 360, { type: 'spring', stiffness: 60, damping: 12 });
  };

  return (
    <motion.div
      className="viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="viewer-card"
        style={{ rotateY: rotate }}
        initial={{ scale: 0.7 }}
        animate={{ scale: 1 }}
        onClick={(e) => {
          e.stopPropagation();
          spin();
        }}
      >
        <div className={`aura aura--${card.tier}`}>
          <Card
            card={card}
            holderName={holderName}
            {...(bankName && { bankName })}
            style={{ '--card-width': 'min(88vw, 380px)' } as CSSProperties}
          />
        </div>
      </motion.div>
      <div
        className="viewer-actions"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <button type="button" className="button" onClick={spin}>
          {t('viewer.spin')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy !== null}
          onClick={share}
        >
          {busy === 'share' ? t('viewer.preparing') : t('viewer.share')}
        </button>
        <button type="button" className="button" disabled={busy !== null} onClick={save}>
          {busy === 'save' ? t('viewer.preparing') : t('viewer.save')}
        </button>
      </div>
      <span className="hint viewer-hint">{t('viewer.close')}</span>
      {createPortal(
        <div className="share-stage" aria-hidden="true">
          <ShareFrame ref={frame} card={card} holderName={holderName} bankName={bankName} />
        </div>,
        document.body,
      )}
    </motion.div>
  );
}
