import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { subscriptionKey } from './api/queries';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initTelegram } from './app/telegram';
import { i18nReady } from './i18n';
import './styles.css';

initTelegram();

/** A player who left a required channel sees the subscribe screen again (D-110). */
const onError = (error: unknown) => {
  if (error instanceof ApiError && error.code === 'SUBSCRIPTION_REQUIRED')
    void queryClient.invalidateQueries({ queryKey: subscriptionKey });
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element is missing');

void i18nReady.then(() => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </QueryClientProvider>
    </StrictMode>,
  );
});
