import { useTranslation } from 'react-i18next';
import { OverlayScreen } from '../components/Overlay';

/** Rules and privacy pages (TZ 19). */
export default function TextScreen({ page }: { page: 'rules' | 'privacy' }) {
  const { t } = useTranslation('common');
  return (
    <OverlayScreen title={t(`${page}.title`)}>
      {t(`${page}.body`)
        .split('\n\n')
        .map((paragraph) => (
          <p key={paragraph} className="text-paragraph">
            {paragraph}
          </p>
        ))}
    </OverlayScreen>
  );
}
