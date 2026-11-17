import { useTranslation } from 'react-i18next';
import { useMe, usePublicConfig } from '../api/queries';
import { OverlayScreen } from '../components/Overlay';
import { regionCurrency } from '../lib/money';
import { NickBonus } from './BonusesScreen';

/** D-173: the bonus for the bot's tag in the Telegram name, from «Ещё». */
export default function NickBonusScreen() {
  const { t } = useTranslation('game');
  const me = useMe();
  const config = usePublicConfig();
  return (
    <OverlayScreen title={t('nickBonus.title')}>
      {!me.data || !config.data ? (
        <div className="screen-loading" aria-busy="true" />
      ) : config.data.nickBonus ? (
        <NickBonus me={me.data} config={config.data} currency={regionCurrency(me.data.region)} />
      ) : (
        <p className="hint">{t('nickBonus.closed')}</p>
      )}
    </OverlayScreen>
  );
}
