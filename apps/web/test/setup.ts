import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { i18nReady } from '../src/i18n';

// Tests run with reduced motion: the ribbon and counters resolve instantly.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

await i18nReady;

afterEach(() => {
  cleanup();
});
