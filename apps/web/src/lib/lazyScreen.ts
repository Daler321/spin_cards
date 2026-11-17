import { type ComponentType, lazy, type LazyExoticComponent } from 'react';

const RELOAD_KEY = 'spincards.chunkReloadAt';
/** One reload per this window: a second failure right after a reload is a real error. */
const RELOAD_WINDOW_MS = 30_000;

function reloadedRecently(now: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return now - last < RELOAD_WINDOW_MS;
  } catch {
    return true;
  }
}

/**
 * A lazily loaded screen. After a deploy the chunks of the previous release are gone; a page opened
 * before it fails to load the next screen, so it reloads once to pick up the new build.
 */
export function lazyScreen<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() =>
    load().catch((error: unknown): Promise<{ default: ComponentType<P> }> => {
      if (reloadedRecently(Date.now())) throw error;
      window.location.reload();
      // Nothing renders until the page reloads.
      return new Promise(() => undefined);
    }),
  );
}
