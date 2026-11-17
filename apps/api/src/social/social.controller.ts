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
} from '@nestjs/common';
import type {
  AchievementsResponse,
  AlbumResponse,
  SeasonCollectionResponse,
  SeasonsResponse,
  LeaderboardResponse,
  PlayerProfileResponse,
  ProfileStats,
  ReferralsResponse,
} from '@spincards/shared';
import { LEADERBOARD_TYPES, PINNED_MEDALS_MAX, TIERS } from '@spincards/shared';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { ReferralService } from '../game/referral.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { AchievementsService } from '../game/achievements.service.js';
import { AlbumService } from './album.service.js';
import { SocialService } from './social.service.js';

const UsernameParam = z.object({ username: z.string().trim().min(3).max(33) });
const LeaderboardQuery = z.object({ type: z.enum(LEADERBOARD_TYPES).default('season') });
const SettingsSchema = z
  .object({
    notificationsEnabled: z.boolean().optional(),
    hideFromLeaderboard: z.boolean().optional(),
    pinnedMedals: z.array(z.string().min(1).max(64)).max(PINNED_MEDALS_MAX).optional(),
    autoCashoutTiers: z.array(z.enum(TIERS)).max(TIERS.length).optional(),
  })
  .strict();

@Controller('v1')
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly referrals: ReferralService,
    private readonly config: GameConfigService,
    private readonly albums: AlbumService,
    private readonly achievements: AchievementsService,
  ) {}

  @Get('leaderboard')
  leaderboard(
    @CurrentUser() user: RequestUser,
    @Query(new ZodPipe(LeaderboardQuery)) query: z.infer<typeof LeaderboardQuery>,
  ): Promise<LeaderboardResponse> {
    return this.social.leaderboard(user.id, query.type);
  }

  @Get('referrals')
  async referralsList(@CurrentUser() user: RequestUser): Promise<ReferralsResponse> {
    return this.referrals.list(user.id, (await this.config.active()).config);
  }

  /** The album of trophies (D-129). */
  @Get('album')
  album(@CurrentUser() user: RequestUser): Promise<AlbumResponse> {
    return this.albums.album(user.id);
  }

  /** Medals and achievements (D-133). */
  @Get('achievements')
  achievementsList(@CurrentUser() user: RequestUser): Promise<AchievementsResponse> {
    return this.achievements.list(user.id);
  }

  /** Which bank × tier of the season the player has dropped (D-130). */
  @Get('season/collection')
  seasonCollection(@CurrentUser() user: RequestUser): Promise<SeasonCollectionResponse> {
    return this.albums.seasonCollection(user.id);
  }

  /** D-177: the current season and the earlier ones. */
  @Get('seasons')
  seasonsInfo(): Promise<SeasonsResponse> {
    return this.social.seasonsInfo();
  }

  /** D-177: a player's public profile by @username (hidden players are not found). */
  @Get('players/by-username/:username')
  playerByUsername(
    @CurrentUser() user: RequestUser,
    @Param(new ZodPipe(UsernameParam)) params: z.infer<typeof UsernameParam>,
  ): Promise<PlayerProfileResponse> {
    return this.social.playerByUsername(user.id, params.username);
  }

  @Get('players/:id')
  player(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PlayerProfileResponse> {
    return this.social.player(user.id, id);
  }

  @Get('me/stats')
  stats(@CurrentUser() user: RequestUser): Promise<ProfileStats> {
    return this.social.stats(user.id);
  }

  @Post('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit('mutation')
  async settings(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>,
  ): Promise<void> {
    await this.social.updateSettings(user.id, body);
  }
}
