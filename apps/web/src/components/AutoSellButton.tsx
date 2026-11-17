import { type MeResponse, TIERS } from '@spincards/shared';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { useToast } from '../state/toast';
import { Sheet } from './Overlay';

/** D-178: the auto-sell tiers from the main screen (under the luck chip), in a sheet. */
export function AutoSellButton({ me }: { me: MeResponse }) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const tiers = me.settings.autoCashoutTiers;
  return (
    <>
      <button
        type="button"
        className={`autosell-chip ${tiers.length > 0 ? 'is-on' : ''}`}
        onClick={() => {
          haptics.select();
          setOpen(true);
        }}
      >
        {tiers.length > 0 ? t('autoSell.chipOn', { count: tiers.length }) : t('autoSell.chip')}
      </button>
      <AnimatePresence>
        {open && (
          <Sheet
            onClose={() => {
              setOpen(false);
            }}
          >
            <h3>{t('profile.autoSell')}</h3>
            <p className="sheet-text hint">{t('autoSell.hint')}</p>
            {TIERS.map((tier) => (
              <label key={tier} className="toggle">
                <span>{t(`tiers.${tier}`)}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={tiers.includes(tier)}
                  disabled={settings.isPending}
                  onChange={(e) => {
                    haptics.select();
                    settings.mutate(
                      {
                        autoCashoutTiers: e.target.checked
                          ? [...tiers, tier]
                          : tiers.filter((x) => x !== tier),
                      },
                      {
                        onError: (error) => {
                          toast(errorText(t, error), 'error');
                        },
                      },
                    );
                  }}
                />
              </label>
            ))}
          </Sheet>
        )}
      </AnimatePresence>
    </>
  );
}
