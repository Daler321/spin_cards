import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyScreen } from '../src/lib/lazyScreen';

describe('lazy screens after a deploy', () => {
  const reload = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    vi.stubGlobal('location', { reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reloads the page once when a chunk of the previous release is gone', async () => {
    const Broken = lazyScreen<object>(() => Promise.reject(new Error('Failed to fetch module')));
    render(
      <Suspense fallback={<span>loading</span>}>
        <Broken />
      </Suspense>,
    );
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('loading')).toBeTruthy();
  });

  it('does not loop: a second failure right after the reload is an error', async () => {
    sessionStorage.setItem('spincards.chunkReloadAt', String(Date.now()));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = lazyScreen<object>(() => Promise.reject(new Error('still broken')));
    const onError = vi.fn();
    window.addEventListener('error', onError);
    render(
      <Suspense fallback={null}>
        <Broken />
      </Suspense>,
    );
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
    expect(reload).not.toHaveBeenCalled();
    window.removeEventListener('error', onError);
    error.mockRestore();
  });

  it('renders the screen when its chunk loads', async () => {
    const Fine = lazyScreen(() => Promise.resolve({ default: () => <p>holder</p> }));
    render(
      <Suspense fallback={null}>
        <Fine />
      </Suspense>,
    );
    expect(await screen.findByText('holder')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});
