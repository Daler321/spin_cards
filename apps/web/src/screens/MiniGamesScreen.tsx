import { MINIGAMES } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useMiniGames } from '../api/queries';
import { haptics } from '../app/telegram';
import { MiniGameIcon } from '../components/minigames/MiniGameIcon';
import { OverlayScreen } from '../components/Overlay';
import { useNavigation } from '../state/navigation';

/** D-169/D-177: the four mini-games as tiles. */
export default function MiniGamesScreen() {
  const { t } = useTranslation(['common', 'game']);
  const open = useNavigation((s) => s.open);
  const games = useMiniGames();
  return (
    <OverlayScreen title={t('more.games')}>
      <p className="hint">{t('more.gamesHint')}</p>
      {games.data && !games.data.enabled ? (
        <p className="empty">{t('game:head.gamesSoon')}</p>
      ) : (
        <div className="game-tiles">
          {MINIGAMES.map((game) => (
            <button
              key={game}
              type="button"
              className="game-tile"
              onClick={() => {
                haptics.select();
                open({ name: 'minigame', game });
              }}
            >
              <MiniGameIcon game={game} />
              <strong>{t(`game:minigames.names.${game}`)}</strong>
              <span className="hint">{t(`game:minigames.tiles.${game}`)}</span>
            </button>
          ))}
        </div>
      )}
    </OverlayScreen>
  );
}
