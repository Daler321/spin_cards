import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadDismissed,
  saveDismissed,
  type TutorialState,
  type TutorialStep,
  tutorialStep,
} from '../lib/tutorial';

/** One short tip for a new player about what to do right now; a closed tip never comes back. */
export function CoachHint(props: Omit<TutorialState, 'dismissed'>) {
  const { t } = useTranslation('game');
  const [dismissed, setDismissed] = useState<ReadonlySet<TutorialStep>>(loadDismissed);
  const step = tutorialStep({ ...props, dismissed });
  return (
    <AnimatePresence initial={false}>
      {step && (
        <motion.div
          key={step}
          className="coach-hint"
          role="status"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <span className="coach-hint-icon" aria-hidden="true">
            💡
          </span>
          <span className="coach-hint-text">{t(`tutorial.${step}`)}</span>
          <button
            type="button"
            className="coach-hint-close"
            aria-label={t('tutorial.close')}
            onClick={() => {
              const next = new Set(dismissed).add(step);
              saveDismissed(next);
              setDismissed(next);
            }}
          >
            ×
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
