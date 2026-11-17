import { useTranslation } from 'react-i18next';
import { useStarsPurchase } from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { useToast } from '../state/toast';

/** D-146: "N ⭐" — buys a Stars product through Telegram's payment form. */
export function StarsButton({
  productId,
  cardId,
  stars,
  label,
  disabled = false,
  className = 'button button--small button--stars',
}: {
  productId: string;
  cardId?: string;
  stars: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('shop');
  const toast = useToast((s) => s.show);
  const purchase = useStarsPurchase();
  const price = t('stars.price', { stars });
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || purchase.isPending}
      onClick={() => {
        haptics.impact('light');
        purchase.mutate(
          { productId, ...(cardId && { cardId }) },
          {
            onSuccess: (status) => {
              if (status === 'paid') {
                haptics.notify('success');
                toast(t('stars.paid'), 'success');
              } else if (status === 'failed') toast(t('stars.failed'), 'error');
              else if (status === 'unsupported') toast(t('stars.unsupported'), 'info');
            },
            onError: (e) => {
              haptics.notify('error');
              toast(errorText(t, e), 'error');
            },
          },
        );
      }}
    >
      {label ? `${label} · ${price}` : price}
    </button>
  );
}
