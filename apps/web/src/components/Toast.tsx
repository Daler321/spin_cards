import { AnimatePresence, motion } from 'motion/react';
import { useToast } from '../state/toast';

export function Toast() {
  const { message, kind, hide } = useToast();
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          className={`toast toast--${kind}`}
          role="status"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          onClick={hide}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
