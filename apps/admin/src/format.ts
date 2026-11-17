import { useTranslation } from 'react-i18next';
import { AdminApiError } from './api';

const LOCALE = 'ru-RU';

export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function dateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function useErrorText() {
  const { t } = useTranslation('errors');
  return (error: unknown) =>
    error instanceof AdminApiError
      ? t(error.code === 'NETWORK' ? 'INTERNAL_ERROR' : error.code)
      : t('INTERNAL_ERROR');
}
