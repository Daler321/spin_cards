import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlayerByUsername } from '../api/queries';
import { haptics } from '../app/telegram';
import { OverlayScreen } from '../components/Overlay';
import { PlayerProfileView } from '../components/PlayerProfileView';
import { errorText } from '../lib/errors';

/** D-177: another player's collection and album by @username. */
export default function PlayerSearchScreen() {
  const { t } = useTranslation(['game', 'errors']);
  const [input, setInput] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const player = usePlayerByUsername(asked);
  const name = input.trim().replace(/^@/, '');
  return (
    <OverlayScreen title={t('playerSearch.title')}>
      <p className="hint">{t('playerSearch.hint')}</p>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.length < 3) return;
          haptics.select();
          setAsked(name);
        }}
      >
        <input
          className="input"
          placeholder={t('playerSearch.placeholder')}
          autoCapitalize="none"
          autoCorrect="off"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
        />
        <button type="submit" className="button button--primary" disabled={name.length < 3}>
          {t('playerSearch.find')}
        </button>
      </form>
      {asked !== null &&
        (player.isLoading ? (
          <div className="screen-loading" aria-busy="true" />
        ) : player.error ? (
          <p className="empty">{errorText(t, player.error)}</p>
        ) : (
          player.data && <PlayerProfileView p={player.data} />
        ))}
    </OverlayScreen>
  );
}
