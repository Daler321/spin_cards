import { useSyncExternalStore } from 'react';

interface Clock {
  subscribe: (listener: () => void) => () => void;
  read: () => number;
}

/** One shared timer per interval for the whole app, running only while someone listens. */
const clocks = new Map<number, Clock>();

function createClock(intervalMs: number): Clock {
  const listeners = new Set<() => void>();
  let now = Date.now();
  let timer: number | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === null) {
        now = Date.now();
        timer = window.setInterval(() => {
          now = Date.now();
          for (const notify of listeners) notify();
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      };
    },
    read: () => now,
  };
}

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = createClock(intervalMs);
    clocks.set(intervalMs, clock);
  }
  return clock;
}

/** The current time, refreshed every `intervalMs`; only components that read it re-render. */
export function useNow(intervalMs = 1000): number {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.read);
}
