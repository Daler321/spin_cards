import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** Human text for any error: server codes via the `errors` namespace, network separately. */
export function errorText(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') return t('common:offline');
    if (error.code === 'NOT_IN_TELEGRAM') return t('common:openInTelegram');
    return t(`errors:${error.code}`);
  }
  return t('errors:INTERNAL_ERROR');
}
