/**
 * A value read on hot paths, often inside a database transaction (D-118). Once loaded, a stale
 * value is still returned while one background query refreshes it: a refresh never waits for a
 * second pool connection from inside a transaction, which under load used to exhaust the pool
 * (every connection held by a transaction waiting for one more). Only the very first read blocks,
 * so services warm it up when the process starts.
 */
export class RefreshingCache<T> {
  private current: { value: T; loadedAt: number } | null = null;
  private loading: Promise<T> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
  ) {}

  async get(): Promise<T> {
    if (!this.current) return this.refresh();
    if (performance.now() - this.current.loadedAt >= this.ttlMs) {
      // why: a failed background refresh keeps the last good value; the next read retries.
      this.refresh().catch(() => undefined);
    }
    return this.current.value;
  }

  /** Loads now (one query however many callers wait); call outside transactions. */
  refresh(): Promise<T> {
    this.loading ??= this.load()
      .then((value) => {
        this.current = { value, loadedAt: performance.now() };
        return value;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}
