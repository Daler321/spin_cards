import type { MiniGameId, MiniGameWallet } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useMe, useMiniGames } from '../api/queries';
import { Blackjack } from '../components/minigames/Blackjack';
import { Coinflip } from '../components/minigames/Coinflip';
import { Mines } from '../components/minigames/Mines';
import { Plinko } from '../components/minigames/Plinko';
import { OverlayScreen } from '../components/Overlay';
import { regionCurrency } from '../lib/money';

/** D-169: one mini-game; bets in the currency of the header switch. */
export default function MiniGameScreen({ game }: { game: MiniGameId }) {
  const { t } = useTranslation('game');
  const info = useMiniGames();
  const me = useMe();
  const title = t(`minigames.names.${game}`);
  if (!info.data || !me.data)
    return (
      <OverlayScreen title={title}>
        <div className="screen-loading" />
      </OverlayScreen>
    );
  if (!info.data.enabled)
    return (
      <OverlayScreen title={title}>
        <p className="empty">{t('minigames.closed')}</p>
      </OverlayScreen>
    );
  const currency = regionCurrency(me.data.region);
  const wallet: MiniGameWallet = info.data.wallets.find((w) => w.currency === currency) ?? {
    currency,
    balance: 0,
    minBet: 0,
    maxBet: 0,
  };
  const props = { info: info.data, wallet };
  return (
    <OverlayScreen title={title}>
      <div className="mg">
        {game === 'mines' && <Mines {...props} />}
        {game === 'plinko' && <Plinko {...props} />}
        {game === 'coinflip' && <Coinflip {...props} />}
        {game === 'blackjack' && <Blackjack {...props} />}
      </div>
    </OverlayScreen>
  );
}
