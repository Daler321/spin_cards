import type { CardView } from '@spincards/shared';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlbum, useMe, usePublicConfig, useRemoveTrophy } from '../api/queries';
import { StarsButton } from '../components/StarsButton';
import { haptics } from '../app/telegram';
import { Card } from '../components/card/Card';
import { OverlayScreen, Sheet } from '../components/Overlay';
import { errorText } from '../lib/errors';
import { useToast } from '../state/toast';

/** The album of trophies (D-129): cards the player chose to keep forever and show to others. */
export default function AlbumScreen() {
  const { t } = useTranslation(['game', 'common']);
  const album = useAlbum();
  const me = useMe();
  const remove = useRemoveTrophy();
  const config = usePublicConfig();
  const toast = useToast((s) => s.show);
  const [removing, setRemoving] = useState<CardView | null>(null);
  const data = album.data;
  return (
    <OverlayScreen title={t('album.title')}>
      {!data || !me.data ? (
        <div className="screen-loading" aria-busy="true" />
      ) : (
        <div className="album">
          <p className="hint">{t('album.hint')}</p>
          <div className="album-progress">
            <strong>{t('album.slots', { used: data.slots.used, total: data.slots.total })}</strong>
            <div
              className="luck-meter-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={data.slots.total}
              aria-valuenow={data.slots.used}
            >
              <span
                className="luck-meter-fill"
                style={{
                  width: `${String((data.slots.used / Math.max(1, data.slots.total)) * 100)}%`,
                }}
              />
            </div>
          </div>
          {data.trophies.length === 0 ? (
            <p className="empty">{t('album.empty')}</p>
          ) : (
            <div className="card-grid">
              {data.trophies.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="card-tile"
                  aria-label={t('album.remove')}
                  onClick={() => {
                    setRemoving(card);
                  }}
                >
                  <Card
                    card={card}
                    holderName={me.data.firstName}
                    animated={false}
                    className="gc--fluid"
                  />
                </button>
              ))}
            </div>
          )}
          {config.data?.stars ? (
            <StarsButton
              productId="album_slot"
              stars={config.data.stars.albumSlot}
              label={t('shop:stars.albumSlot')}
              className="button button--stars"
            />
          ) : (
            <button type="button" className="button" disabled>
              {t('album.moreSlotsSoon')}
            </button>
          )}
        </div>
      )}
      <AnimatePresence>
        {removing && (
          <Sheet
            onClose={() => {
              setRemoving(null);
            }}
          >
            <p className="sheet-text">{t('album.removeConfirm')}</p>
            <div className="sheet-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setRemoving(null);
                }}
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(removing.id, {
                    onSuccess: () => {
                      haptics.notify('success');
                      toast(t('album.removed'), 'success');
                      setRemoving(null);
                    },
                    onError: (e) => {
                      haptics.notify('error');
                      toast(errorText(t, e), 'error');
                    },
                  });
                }}
              >
                {t('album.removeShort')}
              </button>
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </OverlayScreen>
  );
}
