import type { Region } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useRegion } from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { useToast } from '../state/toast';

/** One tap toggles the region (and the currency, D-156); the knob slides to the active one. */
export function RegionToggle({ region, disabled }: { region: Region; disabled: boolean }) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const mutation = useRegion();
  const next: Region = region === 'US' ? 'RU' : 'US';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={region === 'US'}
      aria-label={t('region.label')}
      className={`region-toggle ${region === 'US' ? 'is-us' : ''}`}
      disabled={disabled || mutation.isPending}
      onClick={() => {
        haptics.select();
        mutation.mutate(next, {
          onError: (e) => {
            toast(errorText(t, e), 'error');
          },
        });
      }}
    >
      <span className="region-toggle-knob" aria-hidden="true" />
      {(['RU', 'US'] as const).map((r) => (
        <span
          key={r}
          className={`region-toggle-label ${region === r ? 'is-on' : ''}`}
          title={t(`region.${r}`)}
        >
          {t(`region.short.${r}`)}
        </span>
      ))}
    </button>
  );
}
