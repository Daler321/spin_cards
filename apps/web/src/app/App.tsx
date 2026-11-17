import { AnimatePresence } from 'motion/react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { lazyScreen } from '../lib/lazyScreen';
import { useTranslation } from 'react-i18next';
import { api, ApiError, signIn } from '../api/client';
import { useMe, usePublicConfig, useSubscription } from '../api/queries';
import { SeasonCardDesign } from '../lib/useCardDesign';
import { Header } from '../components/Header';
import { Onboarding } from '../components/Onboarding';
import { onboardingSeen } from '../lib/onboarding';
import { TabBar } from '../components/TabBar';
import { Toast } from '../components/Toast';
import { WalletPrompt } from '../components/WalletPrompt';
import { errorText } from '../lib/errors';
import { SubscribeScreen } from '../screens/SubscribeScreen';
import { applyTextOverrides } from '../i18n';
import { type Overlay, type Tab, useNavigation } from '../state/navigation';
import { bindBackButton } from './telegram';

const TAB_SCREENS: Record<Tab, ReturnType<typeof lazyScreen<object>>> = {
  game: lazyScreen(() => import('../screens/RouletteScreen')),
  holder: lazyScreen(() => import('../screens/HolderScreen')),
  wallet: lazyScreen(() => import('../screens/WalletScreen')),
  bonuses: lazyScreen(() => import('../screens/BonusesScreen')),
  rating: lazyScreen(() => import('../screens/RatingScreen')),
  more: lazyScreen(() => import('../screens/MoreScreen')),
};
const CardScreen = lazyScreen(() => import('../screens/CardScreen'));
const ProfileScreen = lazyScreen(() => import('../screens/ProfileScreen'));
const OddsScreen = lazyScreen(() => import('../screens/OddsScreen'));
const QuestsScreen = lazyScreen(() => import('../screens/QuestsScreen'));
const AlbumScreen = lazyScreen(() => import('../screens/AlbumScreen'));
const SeasonCollectionScreen = lazyScreen(() => import('../screens/SeasonCollectionScreen'));
const TextScreen = lazyScreen(() => import('../screens/TextScreen'));
const MiniGameScreen = lazyScreen(() => import('../screens/MiniGameScreen'));
const ShopScreen = lazyScreen(() => import('../screens/ShopScreen'));
const WheelScreen = lazyScreen(() => import('../screens/WheelScreen'));
const CraftScreen = lazyScreen(() => import('../screens/CraftScreen'));
const MiniGamesScreen = lazyScreen(() => import('../screens/MiniGamesScreen'));
const ReferralsScreen = lazyScreen(() => import('../screens/ReferralsScreen'));
const MedalsScreen = lazyScreen(() => import('../screens/MedalsScreen'));
const NickBonusScreen = lazyScreen(() => import('../screens/NickBonusScreen'));
const SeasonsScreen = lazyScreen(() => import('../screens/SeasonsScreen'));
const PlayerSearchScreen = lazyScreen(() => import('../screens/PlayerSearchScreen'));
const CardGallery = import.meta.env.DEV ? lazyScreen(() => import('../screens/CardGallery')) : null;

type Status = { kind: 'signing-in' } | { kind: 'ready' } | { kind: 'failed'; error: unknown };

export function App() {
  if (CardGallery && window.location.hash === '#gallery') {
    return (
      <Suspense fallback={null}>
        <CardGallery />
      </Suspense>
    );
  }
  return <Game />;
}

function Game() {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<Status>({ kind: 'signing-in' });

  const run = useCallback(() => {
    signIn().then(
      () => {
        setStatus({ kind: 'ready' });
        // Session analytics (D-097); losing it never affects the game.
        api('/v1/events', { method: 'POST', body: { name: 'app_open' } }).catch(() => undefined);
      },
      (error: unknown) => {
        setStatus({ kind: 'failed', error });
      },
    );
  }, []);
  const retry = () => {
    setStatus({ kind: 'signing-in' });
    run();
  };
  useEffect(run, [run]);

  if (status.kind === 'signing-in')
    return <div className="screen-loading" aria-busy="true" aria-label={t('loading')} />;
  if (status.kind === 'failed') {
    const notInTelegram =
      status.error instanceof ApiError && status.error.code === 'NOT_IN_TELEGRAM';
    return (
      <div className="screen-message">
        <h1>{notInTelegram ? t('openInTelegram') : t('somethingWrong')}</h1>
        <p>{notInTelegram ? t('openInTelegramHint') : errorText(t, status.error)}</p>
        {!notInTelegram && (
          <button type="button" className="button button--primary" onClick={retry}>
            {t('retry')}
          </button>
        )}
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const subscription = useSubscription();
  // D-134: owner-edited texts apply to every screen, the subscription gate included.
  const texts = usePublicConfig().data?.texts;
  useEffect(() => {
    if (texts) applyTextOverrides(texts);
  }, [texts]);
  // D-153: no game before the answer (a player from a link must not slip in meanwhile).
  if (subscription.isPending) return <div className="screen-loading" aria-busy="true" />;
  if (subscription.data?.required && !subscription.data.ok)
    return <SubscribeScreen status={subscription.data} />;
  return <ShellContent />;
}

function ShellContent() {
  const me = useMe();
  const config = usePublicConfig();
  const tab = useNavigation((s) => s.tab);
  const stack = useNavigation((s) => s.stack);
  const back = useNavigation((s) => s.back);
  const [onboarded, setOnboarded] = useState(onboardingSeen);

  useEffect(() => bindBackButton(stack.length > 0 ? back : null), [stack.length, back]);

  if (!me.data || !config.data) return <div className="screen-loading" aria-busy="true" />;
  if (!onboarded && me.data.game.totalSpins === 0) {
    return (
      <Onboarding
        onDone={() => {
          setOnboarded(true);
        }}
      />
    );
  }

  const Screen = TAB_SCREENS[tab];
  const top = stack.at(-1);
  return (
    <SeasonCardDesign value={config.data.cardDesign}>
      <div className="shell">
        <Header me={me.data} config={config.data} />
        <main className="shell-main">
          <Suspense fallback={<div className="screen-loading" aria-busy="true" />}>
            <Screen />
          </Suspense>
        </main>
        <TabBar
          badges={{
            bonuses:
              !me.data.game.daily.claimedToday ||
              me.data.game.chest.available > 0 ||
              me.data.game.questsReady > 0,
            game: me.data.game.pendingCardId !== null && tab !== 'game',
          }}
        />
        <AnimatePresence>
          {top && (
            <Suspense key={overlayKey(top)} fallback={null}>
              <OverlayView overlay={top} />
            </Suspense>
          )}
        </AnimatePresence>
        <WalletPrompt />
        <Toast />
      </div>
    </SeasonCardDesign>
  );
}

function OverlayView({ overlay }: { overlay: Overlay }) {
  switch (overlay.name) {
    case 'card':
      return <CardScreen cardId={overlay.cardId} />;
    case 'profile':
      return <ProfileScreen />;
    case 'odds':
      return <OddsScreen />;
    case 'quests':
      return <QuestsScreen />;
    case 'album':
      return <AlbumScreen />;
    case 'seasonCollection':
      return <SeasonCollectionScreen />;
    case 'rules':
    case 'privacy':
      return <TextScreen page={overlay.name} />;
    case 'minigame':
      return <MiniGameScreen game={overlay.game} />;
    case 'shop':
      return <ShopScreen {...(overlay.cardId && { cardId: overlay.cardId })} />;
    case 'wheel':
      return <WheelScreen />;
    case 'craft':
      return <CraftScreen />;
    case 'minigames':
      return <MiniGamesScreen />;
    case 'referrals':
      return <ReferralsScreen />;
    case 'medals':
      return <MedalsScreen />;
    case 'nickBonus':
      return <NickBonusScreen />;
    case 'seasons':
      return <SeasonsScreen />;
    case 'playerSearch':
      return <PlayerSearchScreen />;
  }
}

function overlayKey(overlay: Overlay): string {
  if (overlay.name === 'card') return `card-${overlay.cardId}`;
  return overlay.name === 'minigame' ? `minigame-${overlay.game}` : overlay.name;
}
