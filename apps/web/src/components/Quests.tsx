import type { ChannelQuestView, InviteQuestView, QuestView } from '@spincards/shared';
import type { TFunction } from 'i18next';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useChannelQuestClaim,
  useInviteQuestClaim,
  useMe,
  usePublicConfig,
  useQuestClaim,
  useQuests,
} from '../api/queries';
import { haptics, openTelegramLink, shareURL } from '../app/telegram';
import { errorText } from '../lib/errors';
import { formatCountdown, formatMoney, LOCALE } from '../lib/format';
import { referralLink } from '../lib/referral';
import { useNow } from '../lib/useNow';
import { useToast } from '../state/toast';

/** Daily and season quests (D-124): their own screen, opened from «Бонусы» (D-165). */
export function Quests() {
  const { t } = useTranslation(['game', 'common']);
  const [tab, setTab] = useState<'daily' | 'season'>('daily');
  const quests = useQuests();
  const now = useNow(1000);
  const data = quests.data;
  const all = data ? (tab === 'daily' ? data.daily : data.season) : [];
  // Claimed quests are hidden; ready-to-claim ones come first.
  const list = all
    .filter((q) => !q.claimed)
    .sort((a, b) => Number(b.completed) - Number(a.completed));
  const claimed = all.length - list.length;
  const ready = (items: QuestView[]) => items.filter((q) => q.completed && !q.claimed).length;

  return (
    <section className="section quests">
      <div className="segmented segmented--wide" role="radiogroup">
        {(['daily', 'season'] as const).map((id) => {
          const count = data ? ready(id === 'daily' ? data.daily : data.season) : 0;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={tab === id}
              className={tab === id ? 'is-active' : ''}
              onClick={() => {
                setTab(id);
              }}
            >
              {t(`quests.${id}`)}
              {count > 0 && <span className="quests-ready">{count}</span>}
            </button>
          );
        })}
      </div>
      {data && (
        <p className="hint">
          {tab === 'daily'
            ? t('quests.dailyResets', {
                time: formatCountdown(new Date(data.dailyResetsAt).getTime() - now),
              })
            : data.seasonEndsAt
              ? t('quests.seasonEnds', {
                  date: new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' }).format(
                    new Date(data.seasonEndsAt),
                  ),
                })
              : t('quests.seasonHint')}
        </p>
      )}
      {!data ? (
        <div className="screen-loading" aria-busy="true" />
      ) : (
        <div className="quest-list">
          <AnimatePresence initial={false}>
            {list.map((quest) => (
              <motion.div
                key={quest.id}
                layout
                exit={{ opacity: 0, height: 0, marginBottom: -8 }}
                style={{ overflow: 'hidden' }}
                transition={{ duration: 0.25 }}
              >
                <QuestRow quest={quest} />
              </motion.div>
            ))}
          </AnimatePresence>
          {claimed > 0 && (
            <p className="hint quests-done">
              {list.length === 0
                ? t('quests.allDone')
                : t('quests.doneCount', { count: claimed, total: all.length })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** The channel and invite quests stay on the Bonuses screen itself. */
export function SpecialQuests() {
  const quests = useQuests();
  const data = quests.data;
  if (!data?.channel && !data?.invite) return null;
  return (
    <section className="section quests">
      <AnimatePresence initial={false}>
        {data.channel && (
          <motion.div
            key="channel"
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.25 }}
          >
            <ChannelQuest quest={data.channel} />
          </motion.div>
        )}
        {data.invite && (
          <motion.div
            key="invite"
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.25 }}
          >
            <InviteQuest quest={data.invite} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function QuestRow({ quest }: { quest: QuestView }) {
  const { t } = useTranslation(['game', 'common']);
  const toast = useToast((s) => s.show);
  const claim = useQuestClaim();
  const share = Math.min(1, quest.progress / quest.target);
  const hours = quest.metric === 'hold_hours';
  return (
    <div
      className={`quest ${quest.completed ? 'is-done' : ''} ${quest.claimed ? 'is-claimed' : ''}`}
    >
      <div className="quest-head">
        <strong>{questTitle(t, quest)}</strong>
        <span className="quest-progress">
          {hours
            ? t('quests.progressHours', { progress: quest.progress, target: quest.target })
            : t('quests.progress', { progress: quest.progress, target: quest.target })}
        </span>
      </div>
      <div
        className="luck-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={quest.target}
        aria-valuenow={quest.progress}
      >
        <span className="luck-meter-fill" style={{ width: `${String(share * 100)}%` }} />
      </div>
      <div className="quest-foot">
        <span className="hint">{rewardText(t, quest)}</span>
        {quest.completed && !quest.claimed ? (
          <button
            type="button"
            className="chip-button quest-claim"
            disabled={claim.isPending}
            onClick={() => {
              claim.mutate(quest.id, {
                onSuccess: () => {
                  haptics.notify('success');
                  toast(t('quests.claimedToast', { reward: rewardText(t, quest) }), 'success');
                },
                onError: (e) => {
                  haptics.notify('error');
                  toast(errorText(t, e), 'error');
                },
              });
            }}
          >
            {t('quests.claim')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** D-157: join the channel, then the server checks it with Telegram and pays once a season. */
function ChannelQuest({ quest }: { quest: ChannelQuestView }) {
  const { t } = useTranslation(['game', 'common']);
  const toast = useToast((s) => s.show);
  const claim = useChannelQuestClaim();
  const reward = rewardText(t, quest);
  return (
    <div className="quest quest--channel">
      <div className="quest-head">
        <strong>{t('quests.channel.title')}</strong>
      </div>
      <span className="hint">
        {t('quests.channel.hint', { channel: quest.channels.map((c) => c.title).join(', ') })}
      </span>
      <div className="quest-foot">
        <span className="hint">{reward}</span>
        <span className="quest-channel-actions">
          {quest.channels.map((c) => (
            <button
              key={c.url}
              type="button"
              className="chip-button"
              onClick={() => {
                haptics.impact('light');
                openTelegramLink(c.url);
              }}
            >
              {t('quests.channel.subscribe')}
            </button>
          ))}
          <button
            type="button"
            className="chip-button quest-claim"
            disabled={claim.isPending}
            onClick={() => {
              claim.mutate(undefined, {
                onSuccess: () => {
                  haptics.notify('success');
                  toast(t('quests.claimedToast', { reward }), 'success');
                },
                onError: (e) => {
                  haptics.notify('error');
                  toast(errorText(t, e), 'error');
                },
              });
            }}
          >
            {t('quests.channel.check')}
          </button>
        </span>
      </div>
    </div>
  );
}

/** D-158: steps of friends who qualified this season; each step is claimed once a season. */
function InviteQuest({ quest }: { quest: InviteQuestView }) {
  const { t } = useTranslation(['game', 'common']);
  const toast = useToast((s) => s.show);
  const claim = useInviteQuestClaim();
  const me = useMe();
  const config = usePublicConfig();
  const next = quest.steps.find((s) => !s.claimed);
  const target = next?.friends ?? quest.friends;
  const bot = config.data?.botUsername;
  return (
    <div className="quest quest--channel quest--invite">
      <div className="quest-head">
        <strong>{t('quests.invite.title')}</strong>
        <span className="quest-progress">
          {t('quests.invite.progress', { friends: Math.min(quest.friends, target), target })}
        </span>
      </div>
      <span className="hint">
        {t('quests.invite.hint', { spins: quest.rule.spins, level: quest.rule.level })}
      </span>
      <div
        className="luck-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(quest.friends, target)}
      >
        <span
          className="luck-meter-fill"
          style={{ width: `${String(Math.min(1, quest.friends / target) * 100)}%` }}
        />
      </div>
      <ul className="invite-steps">
        {quest.steps.map((step) => {
          const ready = !step.claimed && quest.friends >= step.friends;
          const reward = rewardText(t, step);
          return (
            <li
              key={step.friends}
              className={`invite-step ${step.claimed ? 'is-claimed' : ''} ${ready ? 'is-ready' : ''}`}
            >
              <span>{t('quests.invite.step', { count: step.friends })}</span>
              <span className="invite-step-reward">{step.claimed ? '✓' : reward}</span>
              {ready && (
                <button
                  type="button"
                  className="chip-button quest-claim"
                  disabled={claim.isPending}
                  onClick={() => {
                    claim.mutate(step.friends, {
                      onSuccess: () => {
                        haptics.notify('success');
                        toast(t('quests.claimedToast', { reward }), 'success');
                      },
                      onError: (e) => {
                        haptics.notify('error');
                        toast(errorText(t, e), 'error');
                      },
                    });
                  }}
                >
                  {t('quests.invite.claim')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {bot && me.data && (
        <div className="quest-foot">
          <span />
          <button
            type="button"
            className="chip-button"
            onClick={() => {
              haptics.impact('light');
              shareURL(referralLink(bot, me.data.referralCode), t('profile.shareText'));
            }}
          >
            {t('quests.invite.call')}
          </button>
        </div>
      )}
    </div>
  );
}

function questTitle(t: TFunction, quest: QuestView): string {
  return t(`quests.metric.${quest.metric}`, {
    count: quest.metric === 'hold_hours' ? Math.round(quest.target / 24) : quest.target,
    tier: quest.tier ? t(`tiers.${quest.tier}`) : '',
  });
}

function rewardText(t: TFunction, quest: Pick<QuestView, 'reward'>): string {
  const r = quest.reward;
  const parts: string[] = [];
  if (r.money) parts.push(formatMoney(r.money.amount, r.money.currency));
  if (r.luck) parts.push(t('daily.luck', { points: r.luck.points, spins: r.luck.spins }));
  if (r.freeSpins) parts.push(t('daily.freeSpins', { count: r.freeSpins }));
  if (r.exp) parts.push(t('quests.exp', { exp: r.exp }));
  return parts.join(' · ');
}
