import { TIERS } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useMe, usePublicConfig } from '../api/queries';
import { OverlayScreen } from '../components/Overlay';
import { formatPercentBp } from '../lib/format';
import { regionCurrency } from '../lib/money';
import { visiblePacks } from '../lib/packs';
import { describeReward } from '../lib/rewards';

/** Published odds (TZ 2.5, 9): same for everyone, independent of payments. */
export default function OddsScreen() {
  const { t } = useTranslation('game');
  const config = usePublicConfig();
  const me = useMe();
  if (!config.data || !me.data)
    return (
      <OverlayScreen title={t('odds.title')}>
        <div className="screen-loading" />
      </OverlayScreen>
    );
  const currency = regionCurrency(me.data.region);
  const packs = visiblePacks(config.data, currency);
  // A pattern's multiplier as the extra balance it gives: ×2.5 is +150 %.
  const extra = (multBp: number) => formatPercentBp(multBp - 10_000);

  return (
    <OverlayScreen title={t('odds.title')}>
      <p className="hint">{t('odds.intro')}</p>
      <div className="table-wrap">
        <table className="odds-table">
          <thead>
            <tr>
              <th>{t('odds.tier')}</th>
              {packs.map((p) => (
                <th key={p.id}>{t(`packs.${p.id}`, { defaultValue: p.id })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <tr key={tier}>
                <td>
                  <span className={`gc-tier gc-tier--${tier}`}>{t(`tiers.${tier}`)}</span>
                </td>
                {packs.map((p) => (
                  <td key={p.id}>{formatPercentBp(p.oddsBp[tier])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section">
        <h3>{t('odds.guarantees')}</h3>
        {packs.map((p) => (
          <div key={p.id} className="list-row">
            <strong>{t(`packs.${p.id}`, { defaultValue: p.id })}</strong>
            <span className="hint">
              {[
                p.pity.rare && t('odds.guaranteeRare', { count: p.pity.rare }),
                p.pity.epic && t('odds.guaranteeEpic', { count: p.pity.epic }),
                p.pity.legendary && t('odds.guaranteeLegendary', { count: p.pity.legendary }),
              ]
                .filter(Boolean)
                .join('; ')}
            </span>
          </div>
        ))}
      </section>

      <section className="section">
        <h3>{t('odds.luckTitle')}</h3>
        <p className="hint">
          {t('odds.luckBody', {
            max: config.data.luck.maxPoints,
            meter: config.data.luck.meterMax,
            numberCap: config.data.luck.numberCapPoints,
            tiers: config.data.tiers
              .map((x) => `${t(`tiers.${x.tier}`)} ${String(x.cardLuckPoints)}`)
              .join(', '),
          })}
        </p>
      </section>

      <section className="section">
        <h3>{t('odds.patternsTitle')}</h3>
        <p className="hint">
          {t('odds.patternsBody', { cap: extra(config.data.numberMultCapBp) })}
        </p>
        <div className="list">
          {config.data.patterns.map((p) => (
            <div key={p.id} className="list-row">
              <span>{t(`patterns.${p.id}`)}</span>
              <strong>
                {t('odds.patternBonus', {
                  // What the card really gets: a single pattern is capped too.
                  percent: extra(Math.min(p.multBp, config.data.numberMultCapBp)),
                })}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h3>{t('odds.wheelTitle')}</h3>
        <div className="list">
          {config.data.wheel.segments.map((segment) => (
            <div key={segment.id} className="list-row">
              <span>{describeReward(t, segment, currency)}</span>
              <strong>{formatPercentBp(segment.oddsBp)}</strong>
            </div>
          ))}
        </div>
        <p className="hint">
          {t('odds.rewardsScale', { percent: formatPercentBp(config.data.rewardLevelBonusBp) })}
        </p>
      </section>

      {config.data.chest.levels.map((level) => (
        <section key={level.level} className="section">
          <h3>{t('odds.chestTitle', { level: level.level })}</h3>
          <div className="list">
            {level.rewards.map((reward, i) => (
              <div key={i} className="list-row">
                <span>{describeReward(t, reward, currency)}</span>
                <strong>{formatPercentBp(reward.oddsBp)}</strong>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="section">
        <h3>{t('odds.nearMissTitle')}</h3>
        <p className="hint">{t('odds.nearMissBody')}</p>
      </section>
    </OverlayScreen>
  );
}
