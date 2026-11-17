import { useTranslation } from 'react-i18next';

/** «Как играть»: the rules of a game, folded by default. */
export function Rules({ text }: { text: string }) {
  const { t } = useTranslation('game');
  return (
    <details className="mg-rules">
      <summary>{t('minigames.rules')}</summary>
      <p>{text}</p>
    </details>
  );
}
