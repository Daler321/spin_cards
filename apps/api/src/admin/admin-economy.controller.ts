import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminAlert,
  AdminConfigDetail,
  AdminConfigVersion,
  AdminExperiment,
  AdminMe,
  AdminStatRow,
  ConfigDiffEntry,
  ConfigIssue,
  ConfigSimulationReport,
} from '@spincards/shared';
import { z } from 'zod';
import { DailyStatsService } from '../analytics/daily-stats.service.js';
import { Public } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { AdminConfigService, DEFAULT_SIM_SPINS } from './admin-config.service.js';
import { auditAdmin } from './admin-users.service.js';
import { AdminGuard, AdminRoles, CurrentAdmin } from './admin.guard.js';

const Reason = z.string().trim().min(3).max(500);
const DraftSchema = z.object({ payload: z.unknown(), comment: Reason });
const ValidateSchema = z.object({ payload: z.unknown() });
const DiffSchema = z.object({ against: z.coerce.number().int().positive().optional() });
const SimulateSchema = z.object({
  spins: z.number().int().min(1000).max(1_000_000).default(DEFAULT_SIM_SPINS),
});
const ActivateSchema = z.object({ reason: Reason });
const GroupName = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const ExperimentSchema = z.object({
  versionId: z.number().int().positive().nullable(),
  reason: Reason,
});
const UserExperimentSchema = z.object({ group: GroupName.nullable(), reason: Reason });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const StatsSchema = z.object({
  from: Day,
  to: Day,
  metrics: z.string().max(500).optional(),
});

/** Configs, A/B, dashboard data and safeguard alerts (TZ 15.1, 15.2). */
@Controller('admin')
@Public()
@UseGuards(AdminGuard)
@RateLimit('mutation')
export class AdminEconomyController {
  constructor(
    private readonly configs: AdminConfigService,
    private readonly stats: DailyStatsService,
    private readonly prisma: PrismaService,
    private readonly gameConfig: GameConfigService,
  ) {}

  // ─── Configs: analysts read, the owner changes ───────────────────────────

  @Get('configs')
  @AdminRoles('analyst')
  list(): Promise<AdminConfigVersion[]> {
    return this.configs.list();
  }

  @Get('configs/:id')
  @AdminRoles('analyst')
  get(@Param('id', ParseIntPipe) id: number): Promise<AdminConfigDetail> {
    return this.configs.get(id);
  }

  @Get('configs/:id/diff')
  @AdminRoles('analyst')
  diff(
    @Param('id', ParseIntPipe) id: number,
    @Query(new ZodPipe(DiffSchema)) query: z.infer<typeof DiffSchema>,
  ): Promise<ConfigDiffEntry[]> {
    return this.configs.diff(id, query.against);
  }

  @Post('configs/validate')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('analyst')
  validate(@Body(new ZodPipe(ValidateSchema)) body: z.infer<typeof ValidateSchema>): {
    issues: ConfigIssue[];
  } {
    return { issues: this.configs.validate(body.payload) };
  }

  @Post('configs')
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(DraftSchema)) body: z.infer<typeof DraftSchema>,
  ) {
    return this.configs.createDraft(admin, body.payload, body.comment);
  }

  @Post('configs/:id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(DraftSchema)) body: z.infer<typeof DraftSchema>,
  ) {
    return this.configs.updateDraft(admin, id, body.payload, body.comment);
  }

  @Post('configs/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(SimulateSchema)) body: z.infer<typeof SimulateSchema>,
  ): Promise<ConfigSimulationReport> {
    return this.configs.simulate(admin, id, body.spins);
  }

  @Post('configs/:id/activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  activate(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(ActivateSchema)) body: z.infer<typeof ActivateSchema>,
  ): Promise<void> {
    return this.configs.activate(admin, id, body.reason);
  }

  // ─── A/B stub ────────────────────────────────────────────────────────────

  @Get('experiments')
  @AdminRoles('analyst')
  experiments(): Promise<AdminExperiment[]> {
    return this.configs.experiments();
  }

  @Post('experiments/:group')
  @HttpCode(HttpStatus.NO_CONTENT)
  bind(
    @CurrentAdmin() admin: AdminMe,
    @Param('group', new ZodPipe(GroupName)) group: string,
    @Body(new ZodPipe(ExperimentSchema)) body: z.infer<typeof ExperimentSchema>,
  ): Promise<void> {
    return this.configs.bindExperiment(admin, group, body.versionId, body.reason);
  }

  @Post('users/:id/experiment')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setUserGroup(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UserExperimentSchema)) body: z.infer<typeof UserExperimentSchema>,
  ): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { experimentGroup: body.group } });
      await auditAdmin(tx, admin, 'user.experiment', { type: 'user', id }, body.reason, {
        group: body.group,
      });
    });
  }

  // ─── Dashboard ───────────────────────────────────────────────────────────

  @Get('stats')
  @AdminRoles('analyst')
  async statsRange(
    @Query(new ZodPipe(StatsSchema)) query: z.infer<typeof StatsSchema>,
  ): Promise<AdminStatRow[]> {
    const metrics = query.metrics?.split(',').filter(Boolean);
    const rows = await this.prisma.dailyStat.findMany({
      where: {
        date: { gte: new Date(`${query.from}T00:00:00Z`), lte: new Date(`${query.to}T00:00:00Z`) },
        ...(metrics && metrics.length > 0 && { metric: { in: metrics } }),
      },
      orderBy: [{ date: 'asc' }, { metric: 'asc' }, { dimension: 'asc' }],
    });
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      metric: r.metric,
      dimension: r.dimension,
      value: r.value.toString(),
    }));
  }

  @Post('stats/recompute')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('analyst')
  recompute(): Promise<{ days: string[] }> {
    return this.stats.runRecent();
  }

  @Get('alerts')
  @AdminRoles('analyst', 'support')
  async alerts(): Promise<AdminAlert[]> {
    // The last week, but nothing from before the statistics start (D-152: the alpha's alerts).
    const { config } = await this.gameConfig.active();
    const week = new Date(Date.now() - 7 * 86_400_000);
    const since = config.analytics.since ? new Date(config.analytics.since) : week;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { startsWith: 'safeguard.' },
        createdAt: { gte: since > week ? since : week },
      },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
