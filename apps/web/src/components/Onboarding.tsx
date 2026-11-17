import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { markOnboardingSeen } from '../lib/onboarding';

/** Three short screens before the very first spin (TZ 13). */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('game');
  const slides = t('onboarding.slides', { returnObjects: true }) as {
    title: string;
    body: string;
  }[];
  const [index, setIndex] = useState(0);
  const finish = () => {
    markOnboardingSeen();
    onDone();
  };
  const slide = slides[index];
  const last = index === slides.length - 1;

  return (
    <div className="onboarding">
      <button type="button" className="onboarding-skip" onClick={finish}>
        {t('onboarding.skip')}
      </button>
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          className="onboarding-slide"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
        >
          <div className={`onboarding-art onboarding-art--${String(index)}`} aria-hidden="true" />
          <h2>{slide?.title}</h2>
          <p>{slide?.body}</p>
        </motion.div>
      </AnimatePresence>
      <div className="onboarding-dots">
        {slides.map((s, i) => (
          <span key={s.title} className={i === index ? 'is-active' : ''} />
        ))}
      </div>
      <button
        type="button"
        className="spin-button"
        onClick={
          last
            ? finish
            : () => {
                setIndex(index + 1);
              }
        }
      >
        {last ? t('onboarding.start') : t('onboarding.next')}
      </button>
    </div>
  );
}
