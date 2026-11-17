import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/queries';
import { formatMoney } from '../lib/format';
import { useWalletPrompt } from '../state/walletPrompt';
import { Sheet } from './Overlay';
import { WalletTopup } from './WalletTopup';

/** D-166: the purchase is paid from the wallet; move the missing money in from a card first. */
export function WalletPrompt() {
  const { t } = useTranslation('shop');
  const me = useMe();
  const request = useWalletPrompt((s) => s.request);
  const close = useWalletPrompt((s) => s.close);
  const wallet = me.data?.wallets.find((w) => w.currency === request?.currency)?.balance ?? 0;
  return (
    <AnimatePresence>
      {request && me.data && (
        <Sheet onClose={close}>
          <h3>{t('walletPrompt.title')}</h3>
          <p className="sheet-text">
            {t('walletPrompt.text', {
              price: formatMoney(request.price, request.currency),
              wallet: formatMoney(wallet, request.currency),
            })}
          </p>
          <WalletTopup
            me={me.data}
            currency={request.currency}
            need={Math.max(0, request.price - wallet)}
            onDone={close}
          />
        </Sheet>
      )}
    </AnimatePresence>
  );
}
