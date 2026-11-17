import type { Currency, TransferEndpoint } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useCollect } from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { useToast } from '../state/toast';

/** D-174: every other held card of the currency sends its whole balance to `to` in one request. */
export function CollectButton({
  currency,
  to,
  label,
  onDone,
}: {
  currency: Currency;
  to: TransferEndpoint;
  label: string;
  onDone?: () => void;
}) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const collect = useCollect();
  return (
    <button
      type="button"
      className="button"
      disabled={collect.isPending}
      onClick={() => {
        haptics.impact('light');
        collect.mutate(
          { currency, to },
          {
            onSuccess: (res) => {
              haptics.notify('success');
              toast(
                t('collect.done', {
                  amount: formatMoney(res.received, currency),
                  count: res.cards,
                }),
                'success',
              );
              onDone?.();
            },
            onError: (e) => {
              haptics.notify('error');
              toast(errorText(t, e), 'error');
            },
          },
        );
      }}
    >
      {label}
    </button>
  );
}
