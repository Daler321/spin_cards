import {
  type Currency,
  type MeResponse,
  type PublicConfigResponse,
  scaleDailyReward,
} from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { SpecialQuests } from '../components/Quests';
import { StarsButton } from '../components/StarsButton';
import {
  useAlbum,
  useAlbumIncomeClaim,
  useNickBonusClaim,
  useChestClaim,
  useChestUpgrade,
  useDailyClaim,
  useMe,
  usePublicConfig,
} from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { formatCountdown, formatMoney } from '../lib/format';
import { regionCurrency } from '../lib/money';
import { credited, describeReward } from '../lib/rewards';
import { useNow } from '../lib/useNow';
import { useWalletGuard } from '../lib/useWalletGuard';
import { useNavigation } from '../state/navigation';
import { useToast } from '../state/toast';

export default function BonusesScreen() {
  const { t } = useTranslation(['shop', 'game']);
  const open = useNavigation((s) => s.open);
  const me = useMe();
  const config = usePublicConfig();
  if (!me.data || !config.data) return <div className="screen-loading" aria-busy="true" />;
  const currency = regionCurrency(me.data.region);
  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('bonuses.title')}</h2>
      </div>
      <button
        type="button"
        className="list-row list-row--link quests-link"
        onClick={() => {
          haptics.select();
          open({ name: 'quests' });
        }}
      >
        <span className="list-main">
          <strong>
            {t('game:quests.title')}
            {me.data.game.questsReady > 0 && (
              <span className="quests-ready">{me.data.game.questsReady}</span>
            )}
          </strong>
          <span className="hint">{t('bonuses.questsHint')}</span>
        </span>
      </button>
      <SpecialQuests />
      <div className="list">
        <LinkRow
          title={t('shopScreen.title')}
          hint={t('common:more.shopHint')}
          onClick={() => {
            open({ name: 'shop' });
          }}
        />
      </div>
      <Daily me={me.data} config={config.data} currency={currency} />
      <Chest me={me.data} config={config.data} currency={currency} />
      <AlbumIncome me={me.data} />
    </div>
  );
}

function LinkRow({ title, hint, onClick }: { title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="list-row list-row--link"
      onClick={() => {
        haptics.select();
        onClick();
      }}
    >
      <span className="list-main">
        <strong>{title}</strong>
        <span className="hint">{hint}</span>
      </span>
    </button>
  );
}

/** D-173: the channel tag in the Telegram name gives a reward once a day. */
export function NickBonus({
  me,
  config,
  currency,
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  currency: Currency;
}) {
  const { t } = useTranslation(['game', 'shop']);
  const toast = useToast((s) => s.show);
  const claim = useNickBonusClaim();
  const now = useNow();
  const view = me.game.nickBonus;
  const rules = config.nickBonus;
  if (!view || !rules) return null;
  // D-178: the nick bonus money is not scaled by level.
  const reward = describeReward(t, rules.reward, currency);
  const waiting = view.availableAt !== null && Date.parse(view.availableAt) > now;
  return (
    <section className="section">
      <h3>{t('nickBonus.title')}</h3>
      <p className="hint">
        {t('nickBonus.hint', { tag: view.tag, reward, hours: rules.checkHours })}
      </p>
      <p className="nick-example">
        <span className="hint">{t('nickBonus.example')}</span>
        <b>{t('nickBonus.exampleName', { tag: view.tag })}</b>
      </p>
      <button
        type="button"
        className="button"
        onClick={() => {
          haptics.impact('light');
          void navigator.clipboard.writeText(view.tag).then(
            () => {
              toast(t('common:copied'), 'success');
            },
            () => undefined,
          );
        }}
      >
        {t('nickBonus.copy', { tag: view.tag })}
      </button>
      {!view.hasTag && <p className="hint">{t('nickBonus.noTag')}</p>}
      <button
        type="button"
        className="button button--primary"
        disabled={!view.hasTag || waiting || claim.isPending}
        onClick={() => {
          claim.mutate(undefined, {
            onSuccess: (res) => {
              haptics.notify('success');
              toast(
                t('nickBonus.done', {
                  reward: describeReward(t, credited(rules.reward, res.credited), currency),
                }),
                'success',
              );
            },
            onError: (e) => {
              haptics.notify('error');
              toast(errorText(t, e), 'error');
            },
          });
        }}
      >
        {waiting && view.availableAt
          ? t('nickBonus.in', { time: formatCountdown(Date.parse(view.availableAt) - now) })
          : t('nickBonus.claim')}
      </button>
    </section>
  );
}

/** D-172: album trophies pay once per interval; the claim does not pile up. */
export function AlbumIncome({ me }: { me: MeResponse }) {
  const { t } = useTranslation(['game', 'shop']);
  const toast = useToast((s) => s.show);
  const album = useAlbum();
  const claim = useAlbumIncomeClaim();
  const config = usePublicConfig();
  const now = useNow();
  const income = album.data?.income;
  if (!me.game.albumIncome || !income || !config.data?.albumIncome) return null;
  const waiting = income.availableAt !== null && Date.parse(income.availableAt) > now;
  return (
    <section className="section">
      <h3>{t('albumIncome.title')}</h3>
      <p className="hint">
        {t('albumIncome.hint', { hours: config.data.albumIncome.intervalHours })}
      </p>
      {income.amount === 0 ? (
        <p className="hint">{t('albumIncome.empty')}</p>
      ) : (
        <button
          type="button"
          className="button button--primary"
          disabled={waiting || claim.isPending}
          onClick={() => {
            claim.mutate(undefined, {
              onSuccess: (res) => {
                haptics.notify('success');
                toast(
                  t('albumIncome.done', { amount: formatMoney(res.amount, res.currency) }),
                  'success',
                );
              },
              onError: (e) => {
                haptics.notify('error');
                toast(errorText(t, e), 'error');
              },
            });
          }}
        >
          {waiting && income.availableAt
            ? t('albumIncome.in', { time: formatCountdown(Date.parse(income.availableAt) - now) })
            : t('albumIncome.claim', { amount: formatMoney(income.amount, income.currency) })}
        </button>
      )}
    </section>
  );
}

function Daily({
  me,
  config,
  currency,
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  currency: Currency;
}) {
  const { t } = useTranslation(['shop', 'game']);
  const toast = useToast((s) => s.show);
  const claim = useDailyClaim();
  const { streak, claimedToday } = me.game.daily;
  const rewards = config.daily.rewards;
  const nextDay = claimedToday ? streak : (streak % rewards.length) + 1;
  // Daily rewards grow with the level (D-113); the claim answers with the scaled reward.
  const scaled = (reward: (typeof rewards)[number]) =>
    scaleDailyReward(reward, me.level, config.daily);

  return (
    <section className="section">
      <h3>{t('bonuses.daily')}</h3>
      <div className="streak">
        {rewards.map((reward, i) => {
          const day = i + 1;
          // The server decides whether the streak continued; the track only mirrors its counter.
          const done = day <= streak && (claimedToday || streak < rewards.length);
          const current = !claimedToday && day === nextDay;
          return (
            <div
              key={day}
              className={`streak-day ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`}
            >
              <span className="streak-label">{t('bonuses.dayN', { day })}</span>
              <span className="streak-reward">{describeReward(t, scaled(reward), currency)}</span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="button button--primary"
        disabled={claimedToday || claim.isPending}
        onClick={() => {
          claim.mutate(undefined, {
            onSuccess: (res) => {
              haptics.notify('success');
              toast(
                `${t('game:daily.claimedTitle', { day: res.day })} · ${describeReward(t, credited(res.reward, res.credited), currency)}`,
                'success',
              );
            },
            onError: (e) => {
              haptics.notify('error');
              toast(errorText(t, e), 'error');
            },
          });
        }}
      >
        {claimedToday ? t('bonuses.claimedToday') : t('bonuses.claim')}
      </button>
    </section>
  );
}

function Chest({
  me,
  config,
  currency,
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  currency: Currency;
}) {
  const { t } = useTranslation('shop');
  const toast = useToast((s) => s.show);
  const claim = useChestClaim();
  const upgrade = useChestUpgrade();
  const { coverage, guard } = useWalletGuard();
  const { available, progress, everySpins, level } = me.game.chest;
  const next = config.chest.levels.find((l) => l.level === level + 1);
  const upgradePrice = next?.upgradePrice?.[currency];
  const fail = (e: unknown) => {
    haptics.notify('error');
    toast(errorText(t, e), 'error');
  };

  return (
    <section className="section">
      <h3>
        {t('bonuses.chest')} · {t('bonuses.chestLevel', { level })}
      </h3>
      <div className="chest">
        <div
          className={`chest-icon chest-icon--l${String(level)} ${available > 0 ? 'is-ready' : ''}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 48 48">
            <path
              d="M6 20h36v20H6zM6 20l4-10h28l4 10M24 20v20M20 27h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="chest-info">
          <strong>
            {available > 0
              ? t('bonuses.chestReady', { count: available })
              : t('bonuses.chestProgress', { progress, every: everySpins })}
          </strong>
          <span className="progress">
            <span
              className="progress-fill"
              style={{ width: `${String((progress / everySpins) * 100)}%` }}
            />
          </span>
        </div>
        <button
          type="button"
          className="button button--small button--primary"
          disabled={available < 1 || claim.isPending}
          onClick={() => {
            claim.mutate(undefined, {
              onSuccess: (res) => {
                haptics.notify('success');
                toast(
                  t('bonuses.chestReward', {
                    reward: describeReward(t, credited(res.reward, res.credited), currency),
                  }),
                  'success',
                );
              },
              onError: fail,
            });
          }}
        >
          {t('bonuses.open')}
        </button>
      </div>
      {next && (upgradePrice !== undefined || next.upgradeStarsPrice != null) ? (
        <div className="button-row button-row--pair">
          {upgradePrice !== undefined && (
            <button
              type="button"
              className="button"
              disabled={coverage(currency, upgradePrice) === 'short' || upgrade.isPending}
              onClick={() => {
                if (!guard(currency, upgradePrice)) return;
                upgrade.mutate(
                  { currency },
                  {
                    onSuccess: () => {
                      haptics.notify('success');
                    },
                    onError: fail,
                  },
                );
              }}
            >
              {t('bonuses.chestUpgrade', {
                level: next.level,
                price: formatMoney(upgradePrice, currency),
              })}
            </button>
          )}
          {config.stars && next.upgradeStarsPrice != null && (
            <StarsButton
              productId="chest_upgrade"
              stars={next.upgradeStarsPrice}
              label={t('bonuses.chestUpgradeStars', { level: next.level })}
              className="button button--stars"
            />
          )}
        </div>
      ) : (
        <span className="hint">{t('bonuses.chestMax')}</span>
      )}
    </section>
  );
}
