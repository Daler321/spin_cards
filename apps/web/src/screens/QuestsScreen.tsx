import { useTranslation } from 'react-i18next';
import { OverlayScreen } from '../components/Overlay';
import { Quests } from '../components/Quests';

/** Daily and season quests over the Bonuses tab (D-165). */
export default function QuestsScreen() {
  const { t } = useTranslation('game');
  return (
    <OverlayScreen title={t('quests.title')} withTabs>
      <Quests />
    </OverlayScreen>
  );
}
