import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { localDate } from '../analytics/metrics.js';
import { FlagsService, packPauseFlag } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OpsAlertsService } from '../ops/alerts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

interface RtpRow {
  pack_id: string;
  currency: string;
  spins: bigint;
  issued: bigint;
  paid: bigint;
}

/**
 * Safeguards (TZ 15.2, D-103), run by the worker every few minutes:
 * - factual RTP of each paid pack over the window, from spin events: outside [minBp, maxBp] with
 *   enough spins raises an alert; a too-high RTP also pauses the pack when autoPause is on (flag
 *   `pack_paused:<id>`, lifted by the owner in the admin panel);
 * - today's emission per currency above the daily limit raises an alert.
 * Alerts go to audit_log (`safeguard.*`, actor system) once per window, and to the logs.
 */
@Injectable()
export class SafeguardsService {
  private readonly logger = new Logger(SafeguardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly flags: FlagsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ops: OpsAlertsService,
  ) {}

  async run(now = new Date()): Promise<{ alerts: number }> {
    const { config } = await this.config.active();
    const rules = config.safeguards;
    let alerts = 0;

    const since = new Date(now.getTime() - rules.rtp.windowMinutes * 60_000);
    const rows = await this.prisma.$queryRaw<RtpRow[]>`
      SELECT props->>'packId' AS pack_id, props->>'currency' AS currency, count(*)::bigint AS spins,
        sum((props->>'issued')::numeric)::bigint AS issued, sum((props->>'price')::numeric)::bigint AS paid
      FROM events
      WHERE name = 'spin' AND created_at >= ${since} AND (props->>'price')::numeric > 0
      GROUP BY 1, 2`;
    for (const row of rows) {
      if (row.spins < BigInt(rules.rtp.minSpins) || row.paid === 0n) continue;
      const rtpBp = Number((row.issued * 10_000n) / row.paid);
      if (rtpBp >= rules.rtp.minBp && rtpBp <= rules.rtp.maxBp) continue;
      const high = rtpBp > rules.rtp.maxBp;
      const pause = high && rules.rtp.autoPause;
      const fired = await this.alert(
        `rtp:${row.pack_id}:${row.currency}`,
        rules.rtp.windowMinutes * 60,
        'safeguard.rtp',
        {
          packId: row.pack_id,
          currency: row.currency,
          rtpBp,
          spins: Number(row.spins),
          paused: pause,
        },
      );
      if (!fired) continue;
      alerts++;
      if (pause) {
        await this.prisma.featureFlag.upsert({
          where: { key: packPauseFlag(row.pack_id) },
          create: {
            key: packPauseFlag(row.pack_id),
            enabled: true,
            description: `Pack ${row.pack_id} paused by the RTP safeguard`,
            updatedBy: 'safeguard',
          },
          update: { enabled: true, updatedBy: 'safeguard' },
        });
        await this.flags.invalidate();
      }
    }

    // Today's emission (analytics day) per currency.
    const tz = config.analytics.timezone;
    const today = localDate(now, tz);
    const flows = await this.prisma.$queryRaw<{ currency: string; reason: string; net: bigint }[]>`
      SELECT currency, reason::text AS reason, sum(delta)::bigint AS net FROM ledger_entries
      WHERE created_at >= (${today}::date::timestamp AT TIME ZONE ${tz})
      GROUP BY currency, reason`;
    // Net emission: money that appeared in the game today minus money that left it (card
    // issues are mostly paid for by spins, so only the difference is new money, D-109).
    const net = new Map<string, bigint>();
    for (const flow of flows) net.set(flow.currency, (net.get(flow.currency) ?? 0n) + flow.net);
    for (const [currency, value] of net) {
      const limit = rules.dailyEmission[currency as keyof typeof rules.dailyEmission];
      if (value <= BigInt(limit)) continue;
      if (
        await this.alert(`emission:${currency}:${today}`, 26 * 3600, 'safeguard.emission', {
          currency,
          emission: value.toString(),
          limit,
          date: today,
        })
      )
        alerts++;
    }
    return { alerts };
  }

  /** Writes the alert unless the same one fired within `ttlSec`; returns whether it fired. */
  private async alert(
    key: string,
    ttlSec: number,
    action: string,
    payload: Prisma.InputJsonValue,
  ): Promise<boolean> {
    const fresh = await this.redis.set(`safeguard:${key}`, '1', 'EX', ttlSec, 'NX');
    if (fresh !== 'OK') return false;
    this.logger.warn({ action, payload }, 'safeguard alert');
    await this.prisma.auditLog.create({
      data: { actorType: 'system', actorId: 'safeguard', action, payload },
    });
    // Also to the owner's Telegram (D-117); the audit row above already throttles it.
    await this.ops.send(
      `safeguard:${key}`,
      'safeguard',
      { action, details: JSON.stringify(payload) },
      60,
    );
    return true;
  }
}
