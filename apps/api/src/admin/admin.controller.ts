import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminAuditItem,
  AdminChannelCheck,
  AdminShareSettings,
  AdminOpsSettings,
  AdminAccount,
  AdminTextsResponse,
  EditableTextKey,
  AdminFraudEntry,
  AdminOpsStatus,
  AdminOpsTestResult,
  AdminSubscriptionSettings,
  AdminBroadcastItem,
  AdminFlag,
  AdminMe,
  AdminPaymentItem,
  AdminPoolResponse,
  AdminSeasonItem,
  AdminUserDetail,
  AdminUserListItem,
  Page,
} from '@spincards/shared';
import { CURRENCIES, EDITABLE_TEXT_KEYS } from '@spincards/shared';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AntifraudService } from '../antifraud/antifraud.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { TextsService } from '../texts/texts.service.js';
import { OpsAlertsService, OpsSettingsSchema } from '../ops/alerts.service.js';
import { BackupService } from '../ops/backup.service.js';
import { ShareService, ShareSettingsSchema } from '../share/share.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import {
  SubscriptionService,
  SubscriptionSettingsSchema,
} from '../subscription/subscription.service.js';
import { IdempotencyKeySchema } from '../wallet/wallet.controller.js';
import { AdminOpsService } from './admin-ops.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminGuard, AdminRoles, CurrentAdmin } from './admin.guard.js';

/** Every manual change needs a reason (CLAUDE.md, audit_log). */
const Reason = z.string().trim().min(3).max(500);
const SearchSchema = z.object({ q: z.string().max(100).default('') });
const BanSchema = z.object({ banned: z.boolean(), reason: Reason });
const AdjustSchema = z.object({
  currency: z.enum(CURRENCIES),
  amount: z
    .number()
    .int()
    .refine((v) => v !== 0, 'amount must not be zero')
    .refine((v) => Math.abs(v) <= 1_000_000_000_00, 'amount is too large'),
  reason: Reason,
  idempotencyKey: IdempotencyKeySchema,
});
const CardAdjustSchema = AdjustSchema.omit({ currency: true });
const BuffSchema = z.object({
  points: z.number().int().min(1).max(100),
  spins: z.number().int().min(1).max(1000),
  reason: Reason,
});
const SegmentSchema = z.enum(['all', 'active', 'inactive']);
const PreviewSchema = z.object({
  segment: SegmentSchema,
  days: z.coerce.number().int().min(1).max(365).optional(),
});
const BroadcastSchema = z
  .object({
    text: z.string().trim().min(1).max(4096),
    segment: SegmentSchema,
    days: z.number().int().min(1).max(365).optional(),
  })
  .refine((b) => b.segment === 'all' || b.days !== undefined, {
    message: 'days is required for active/inactive',
    path: ['days'],
  });
const FlagSchema = z.object({ enabled: z.boolean(), reason: Reason });
const AuditSchema = z.object({
  action: z.string().max(64).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
});
const PaymentsSchema = z.object({
  status: z.enum(['pending', 'paid', 'refunded', 'failed']).optional(),
});
const RefundSchema = z.object({ reason: Reason });
const SubscriptionBodySchema = SubscriptionSettingsSchema.extend({ reason: Reason });
const ShareBodySchema = ShareSettingsSchema.extend({ reason: Reason });
const OpsBodySchema = OpsSettingsSchema.extend({ reason: Reason });
const SeasonEndSchema = z.object({ endsAt: z.iso.datetime(), reason: Reason });
const TextBodySchema = z.object({
  key: z.enum(EDITABLE_TEXT_KEYS as [EditableTextKey, ...EditableTextKey[]]),
  value: z.string().max(4000).nullable(),
  reason: Reason,
});
const StartLinkBodySchema = z.object({
  startLink: z
    .object({
      text: z.string().trim().min(1).max(64),
      url: z.url().refine((u) => u.startsWith('https://'), 'https only'),
    })
    .nullable(),
  reason: Reason,
});
const BotOptionsBodySchema = z.object({
  bot: z.object({
    supportChatId: z
      .string()
      .trim()
      .regex(/^-?\d{1,20}$/)
      .nullable(),
    channelPosts: z.boolean(),
  }),
  reason: Reason,
});
const AdminRoleSchema = z.enum(['owner', 'analyst', 'support']);
const AdminPassword = z.string().min(12).max(200);
const CreateAdminSchema = z.object({
  login: z
    .string()
    .trim()
    .regex(/^[a-z0-9_.-]{3,32}$/),
  role: AdminRoleSchema,
  password: AdminPassword,
  reason: Reason,
});
const UpdateAdminSchema = z
  .object({
    role: AdminRoleSchema.optional(),
    isActive: z.boolean().optional(),
    password: AdminPassword.optional(),
    resetTotp: z.boolean().optional(),
    reason: Reason,
  })
  .refine((b) => Object.keys(b).length > 1, 'nothing to change');

/** Admin panel (TZ 11.3, 15.3, 15.4). Owner may do everything; other roles as marked. */
@Controller('admin')
@Public()
@UseGuards(AdminGuard)
@RateLimit('mutation')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly ops: AdminOpsService,
    private readonly subscriptions: SubscriptionService,
    private readonly prisma: PrismaService,
    private readonly shareService: ShareService,
    private readonly opsAlerts: OpsAlertsService,
    private readonly backups: BackupService,
    private readonly antifraud: AntifraudService,
    private readonly accounts: AdminAccountsService,
    private readonly textsService: TextsService,
  ) {}

  // ─── Players (support) ───────────────────────────────────────────────────

  @Get('users')
  @AdminRoles('support')
  search(
    @Query(new ZodPipe(SearchSchema)) query: z.infer<typeof SearchSchema>,
  ): Promise<AdminUserListItem[]> {
    return this.users.search(query.q);
  }

  /** Players with antifraud signals (D-119), for a manual look and ban. */
  @Get('fraud')
  @AdminRoles('support')
  fraud(): Promise<AdminFraudEntry[]> {
    return this.antifraud.suspicious();
  }

  @Get('users/:id')
  @AdminRoles('support')
  user(@Param('id', new ParseUUIDPipe()) id: string): Promise<AdminUserDetail> {
    return this.users.detail(id);
  }

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoles('support')
  ban(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(BanSchema)) body: z.infer<typeof BanSchema>,
  ): Promise<void> {
    return this.users.setBanned(admin, id, body.banned, body.reason);
  }

  /** Money changes are owner-only. */
  @Post('users/:id/adjust')
  @HttpCode(HttpStatus.OK)
  adjust(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AdjustSchema)) body: z.infer<typeof AdjustSchema>,
  ) {
    return this.users.adjust(admin, id, body);
  }

  /** Card balances are money too: owner-only. */
  @Post('users/:id/cards/:cardId/adjust')
  @HttpCode(HttpStatus.OK)
  adjustCard(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body(new ZodPipe(CardAdjustSchema)) body: z.infer<typeof CardAdjustSchema>,
  ) {
    return this.users.adjustCard(admin, id, cardId, body);
  }

  @Post('users/:id/buff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoles('support')
  buff(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(BuffSchema)) body: z.infer<typeof BuffSchema>,
  ): Promise<void> {
    return this.users.grantBuff(admin, id, body);
  }

  // ─── Broadcasts (support) ────────────────────────────────────────────────

  @Get('broadcasts')
  @AdminRoles('support')
  broadcasts(): Promise<AdminBroadcastItem[]> {
    return this.ops.listBroadcasts();
  }

  @Get('broadcasts/preview')
  @AdminRoles('support')
  async preview(
    @Query(new ZodPipe(PreviewSchema)) query: z.infer<typeof PreviewSchema>,
  ): Promise<{ recipients: number }> {
    return { recipients: await this.ops.previewBroadcast(query.segment, query.days) };
  }

  @Post('broadcasts')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('support')
  broadcast(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(BroadcastSchema)) body: z.infer<typeof BroadcastSchema>,
  ) {
    return this.ops.createBroadcast(admin, body);
  }

  // ─── Pool, seasons (all roles) ───────────────────────────────────────────

  @Get('pool')
  @AdminRoles('support', 'analyst')
  pool(): Promise<AdminPoolResponse> {
    return this.ops.pool();
  }

  @Get('seasons')
  @AdminRoles('support', 'analyst')
  seasons(): Promise<AdminSeasonItem[]> {
    return this.ops.listSeasons();
  }

  /** Owner: when the current season ends (D-125). */
  @Post('seasons/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  setSeasonEnd(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(SeasonEndSchema)) body: z.infer<typeof SeasonEndSchema>,
  ): Promise<void> {
    return this.ops.setSeasonEnd(admin, new Date(body.endsAt), body.reason);
  }

  // ─── Flags, audit (owner) ────────────────────────────────────────────────

  @Get('flags')
  @AdminRoles('analyst')
  flags(): Promise<AdminFlag[]> {
    return this.ops.listFlags();
  }

  @Post('flags/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  setFlag(
    @CurrentAdmin() admin: AdminMe,
    @Param('key') key: string,
    @Body(new ZodPipe(FlagSchema)) body: z.infer<typeof FlagSchema>,
  ): Promise<void> {
    return this.ops.setFlag(admin, key, body.enabled, body.reason);
  }

  @Get('audit')
  audit(
    @Query(new ZodPipe(AuditSchema)) query: z.infer<typeof AuditSchema>,
  ): Promise<Page<AdminAuditItem>> {
    return this.ops.audit(query);
  }

  // ─── Settings (owner) ────────────────────────────────────────────────────

  @Get('settings/subscription')
  subscriptionSettings(): Promise<AdminSubscriptionSettings> {
    return this.subscriptions.settings();
  }

  @Post('settings/subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveSubscription(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(SubscriptionBodySchema)) body: z.infer<typeof SubscriptionBodySchema>,
  ): Promise<void> {
    const { reason, ...settings } = body;
    await this.subscriptions.save(settings, admin.login);
    await this.prisma.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: admin.id,
        action: 'settings.subscription',
        targetType: 'settings',
        targetId: 'subscription',
        reason,
        payload: settings,
      },
    });
  }

  @Post('settings/subscription/check')
  @HttpCode(HttpStatus.OK)
  checkSubscriptionBot(
    @Body(new ZodPipe(SubscriptionSettingsSchema)) body: AdminSubscriptionSettings,
  ): Promise<AdminChannelCheck[]> {
    return this.subscriptions.checkBot(body);
  }

  @Get('settings/share')
  shareSettings(): Promise<AdminShareSettings> {
    return this.shareService.settings();
  }

  @Post('settings/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveShare(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(ShareBodySchema)) body: z.infer<typeof ShareBodySchema>,
  ): Promise<void> {
    const { reason, ...settings } = body;
    await this.shareService.saveSettings(settings, admin.login);
    await this.prisma.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: admin.id,
        action: 'settings.share',
        targetType: 'settings',
        targetId: 'share',
        reason,
        payload: settings,
      },
    });
  }

  // ─── Texts (owner, D-134) ────────────────────────────────────────────────

  @Get('settings/texts')
  texts(): Promise<AdminTextsResponse> {
    return this.textsService.adminView();
  }

  @Post('settings/texts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setText(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(TextBodySchema)) body: z.infer<typeof TextBodySchema>,
  ): Promise<void> {
    await this.textsService.setText(body.key, body.value, admin.login);
    await this.auditSetting(admin, 'settings.text', body.key, body.reason, { value: body.value });
  }

  @Post('settings/texts/start-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setStartLink(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(StartLinkBodySchema)) body: z.infer<typeof StartLinkBodySchema>,
  ): Promise<void> {
    await this.textsService.setStartLink(body.startLink, admin.login);
    await this.auditSetting(admin, 'settings.start_link', 'start', body.reason, {
      startLink: body.startLink,
    });
  }

  /** D-145: the support group and channel posts. */
  @Post('settings/texts/bot')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setBotOptions(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(BotOptionsBodySchema)) body: z.infer<typeof BotOptionsBodySchema>,
  ): Promise<void> {
    await this.textsService.setBotOptions(body.bot, admin.login);
    await this.auditSetting(admin, 'settings.bot', 'bot', body.reason, body.bot);
  }

  private auditSetting(
    admin: AdminMe,
    action: string,
    targetId: string,
    reason: string,
    payload: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: admin.id,
        action,
        targetType: 'settings',
        targetId,
        reason,
        payload,
      },
    });
  }

  // ─── Admin accounts (owner, D-120) ───────────────────────────────────────

  @Get('admins')
  admins(): Promise<AdminAccount[]> {
    return this.accounts.list();
  }

  @Post('admins')
  @HttpCode(HttpStatus.NO_CONTENT)
  createAdmin(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(CreateAdminSchema)) body: z.infer<typeof CreateAdminSchema>,
  ): Promise<void> {
    const { reason, ...input } = body;
    return this.accounts.create(admin, input, reason);
  }

  @Post('admins/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateAdmin(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateAdminSchema)) body: z.infer<typeof UpdateAdminSchema>,
  ): Promise<void> {
    const { reason, ...changes } = body;
    return this.accounts.update(admin, id, changes, reason);
  }

  // ─── Alerts and backups (owner, D-117) ───────────────────────────────────

  @Get('settings/ops')
  opsSettings(): Promise<AdminOpsSettings> {
    return this.opsAlerts.settings();
  }

  @Post('settings/ops')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveOps(
    @CurrentAdmin() admin: AdminMe,
    @Body(new ZodPipe(OpsBodySchema)) body: z.infer<typeof OpsBodySchema>,
  ): Promise<void> {
    const { reason, ...settings } = body;
    await this.opsAlerts.saveSettings(settings, admin.login);
    await this.prisma.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: admin.id,
        action: 'settings.ops',
        targetType: 'settings',
        targetId: 'ops',
        reason,
        payload: settings,
      },
    });
  }

  @Post('settings/ops/test')
  @HttpCode(HttpStatus.OK)
  testOps(
    @Body(new ZodPipe(OpsSettingsSchema)) body: AdminOpsSettings,
  ): Promise<AdminOpsTestResult[]> {
    return this.opsAlerts.test(body.alertChatIds);
  }

  @Get('ops/status')
  opsStatus(): Promise<AdminOpsStatus> {
    return this.backups.status();
  }

  // ─── Stars payments (support reads, owner refunds) ───────────────────────

  @Get('payments')
  @AdminRoles('support')
  payments(
    @Query(new ZodPipe(PaymentsSchema)) query: z.infer<typeof PaymentsSchema>,
  ): Promise<AdminPaymentItem[]> {
    return this.ops.listPayments(query.status);
  }

  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.NO_CONTENT)
  refund(
    @CurrentAdmin() admin: AdminMe,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(RefundSchema)) body: z.infer<typeof RefundSchema>,
  ): Promise<void> {
    return this.ops.refund(admin, id, body.reason);
  }
}
