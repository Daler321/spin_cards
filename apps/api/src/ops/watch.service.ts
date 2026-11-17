import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';
import { OpsAlertsService } from './alerts.service.js';
import { BackupService } from './backup.service.js';

const MINUTE_MS = 60_000;
const ERRORS_WINDOW_MIN = 5;
const errorsKey = (minute: number) => `ops:5xx:${String(minute)}`;

/** Counts an unexpected 5xx response (ErrorFilter); the watch job sums the last minutes. */
export async function countServerError(redis: Redis, now = Date.now()): Promise<void> {
  const key = errorsKey(Math.floor(now / MINUTE_MS));
  await redis.multi().incr(key).expire(key, 3600).exec();
}

/**
 * Watches the stack from the worker every minute (D-117): health endpoints of the services, a
 * burst of unexpected 5xx responses and free disk space. Each problem alerts once per window;
 * a service that comes back is reported too.
 */
@Injectable()
export class OpsWatchService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly alerts: OpsAlertsService,
    private readonly backups: BackupService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(now = Date.now()): Promise<{ down: string[]; errors: number }> {
    const down = await this.checkServices();
    const errors = await this.checkErrors(now);
    await this.checkDisk();
    return { down, errors };
  }

  private async checkServices(): Promise<string[]> {
    const down: string[] = [];
    for (const { name, url } of this.env.OPS_HEALTH_URLS) {
      const error = await fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((response) => (response.ok ? null : `HTTP ${String(response.status)}`))
        .catch((err: unknown) => (err instanceof Error ? err.message : 'unreachable'));
      const flag = `ops:down:${name}`;
      if (error) {
        down.push(name);
        // Two failed checks in a row: a restart in progress is not an outage.
        const failures = await this.redis.incr(flag);
        await this.redis.expire(flag, 24 * 3600);
        if (failures >= 2) await this.alerts.send(`down:${name}`, 'serviceDown', { name, error });
      } else if ((await this.redis.getdel(flag)) !== null) {
        const wasReported = (await this.redis.exists(`ops:alert:down:${name}`)) === 1;
        await this.alerts.reset(`down:${name}`);
        if (wasReported) await this.alerts.send(`up:${name}`, 'serviceUp', { name }, 60);
      }
    }
    return down;
  }

  private async checkErrors(now: number): Promise<number> {
    const minute = Math.floor(now / MINUTE_MS);
    const keys = Array.from({ length: ERRORS_WINDOW_MIN }, (_, i) => errorsKey(minute - i));
    const counts = await this.redis.mget(keys);
    const total = counts.reduce((sum, value) => sum + Number(value ?? 0), 0);
    if (total >= this.env.OPS_5XX_ALERT)
      await this.alerts.send('5xx', 'errors5xx', { count: total, minutes: ERRORS_WINDOW_MIN });
    return total;
  }

  private async checkDisk(): Promise<void> {
    const disk = await this.backups.disk();
    if (!disk || disk.totalBytes === 0) return;
    const pct = Math.floor((disk.freeBytes / disk.totalBytes) * 100);
    if (pct < this.env.OPS_DISK_FREE_ALERT_PCT) {
      const freeGb = (disk.freeBytes / 1024 ** 3).toFixed(1);
      await this.alerts.send('disk', 'diskLow', { free: freeGb, pct }, 6 * 3600);
    }
  }
}
