import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { i18nReady } from '../src/i18n';

await i18nReady;

afterEach(() => {
  cleanup();
});
