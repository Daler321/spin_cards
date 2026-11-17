import { useTranslation } from 'react-i18next';
import { useMe, usePublicConfig } from '../api/queries';
import { OverlayScreen } from '../components/Overlay';
import { Wheel } from '../components/Wheel';
import { formatPercentBp } from '../lib/format';
import { regionCurrency } from '../lib/money';
import { describeReward, scaleMoney } from '../lib/rewards';

/** The wheel of fortune on its own screen, with every reward and its published odds below. */
export default function WheelScreen() {
  const { t } = useTranslation(['shop', 'game']);
  const me = useMe();
  const config = usePublicConfig();
  if (!me.data || !config.data)
    return (
      <OverlayScreen title={t('bonuses.wheel')}>
        <div className="screen-loading" aria-busy="true" />
      </OverlayScreen>
    );
  const currency = regionCurrency(me.data.region);
  const level = me.data.level;
  const segments = [...config.data.wheel.segments].sort((a, b) => b.oddsBp - a.oddsBp);
  return (
    <OverlayScreen title={t('bonuses.wheel')}>
      <Wheel me={me.data} config={config.data} currency={currency} />
      <section className="section">
        <h3>{t('game:wheelScreen.rewards')}</h3>
        <p className="hint">{t('game:wheelScreen.hint')}</p>
        <div className="list">
          {segments.map((s) => {
            const money = s.money?.[currency];
            const reward =
              money === undefined
                ? s
                : { ...s, money: { [currency]: scaleMoney(money, level, config.data) } };
            return (
              <div key={s.id} className="list-row">
                <div className="list-main">
                  <strong>{describeReward(t, reward, currency)}</strong>
                </div>
                <span className="chip">{formatPercentBp(s.oddsBp)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </OverlayScreen>
  );
}
