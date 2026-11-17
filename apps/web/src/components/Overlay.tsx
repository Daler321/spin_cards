import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { inTelegram } from '../app/telegram';
import { useNavigation } from '../state/navigation';

/**
 * Full-screen page over the tabs. In Telegram the native back button closes it. `withTabs` keeps the
 * tab bar on top: any tab closes the page.
 */
export function OverlayScreen({
  title,
  withTabs = false,
  children,
}: {
  title: string;
  withTabs?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const back = useNavigation((s) => s.back);
  return (
    <motion.div
      className={withTabs ? 'overlay overlay--tabs' : 'overlay'}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.22 }}
    >
      <header className="overlay-header">
        {!inTelegram && (
          <button type="button" className="icon-button" onClick={back} aria-label={t('back')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        )}
        <h1>{title}</h1>
      </header>
      <div className="overlay-body">{children}</div>
    </motion.div>
  );
}

/** Bottom sheet for confirmations and small forms. */
export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <motion.div
      className="sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
