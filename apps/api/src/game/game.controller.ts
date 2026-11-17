import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CURRENCIES, MAX_SPINS_PER_REQUEST } from '@spincards/shared';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { IdempotencyKeySchema } from '../wallet/wallet.controller.js';
import { BonusService } from './bonus.service.js';
import { CardsService } from './cards.service.js';
import { CraftService } from './craft.service.js';
import { IncomeService } from './income.service.js';
import { ShopService } from './shop.service.js';
import { SpinService } from './spin.service.js';

const SpinSchema = z.object({
  packId: z.string().regex(/^[a-z0-9_]{1,32}$/),
  count: z.number().int().min(1).max(MAX_SPINS_PER_REQUEST).default(1),
  payment: z.discriminatedUnion('type', [
    z.object({ type: z.literal('wallet') }),
    z.object({ type: z.literal('card'), cardId: z.uuid() }),
  ]),
  idempotencyKey: IdempotencyKeySchema,
});
const KeySchema = z.object({ idempotencyKey: IdempotencyKeySchema });
const CashoutSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  toCardId: z.uuid().optional(),
});
const TopupSchema = z.object({
  amount: z.number().int().positive().max(1_000_000_000_000),
  idempotencyKey: IdempotencyKeySchema,
});
const BuyHolderSchema = z.object({
  holderId: z.string().regex(/^[a-z0-9_]{1,32}$/),
  payWith: z.enum([...CURRENCIES, 'stars']),
  idempotencyKey: IdempotencyKeySchema,
});
const ShopBuySchema = z.object({
  itemId: z.string().regex(/^[a-z0-9_]{1,32}$/),
  packId: z
    .string()
    .regex(/^[a-z0-9_]{1,32}$/)
    .optional(),
  currency: z.enum(CURRENCIES),
  idempotencyKey: IdempotencyKeySchema,
});
const CardIdsSchema = z.array(z.uuid()).min(1).max(MAX_SPINS_PER_REQUEST);
const CashoutManySchema = z.object({
  cardIds: CardIdsSchema,
  toCardId: z.uuid().optional(),
  idempotencyKey: IdempotencyKeySchema,
});
const HoldManySchema = z.object({ cardIds: CardIdsSchema, idempotencyKey: IdempotencyKeySchema });
const EndpointSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wallet') }),
  z.object({ type: z.literal('card'), cardId: z.uuid() }),
]);
const TransferSchema = z.object({
  from: EndpointSchema,
  to: EndpointSchema,
  amount: z.number().int().positive().max(1_000_000_000_000),
  idempotencyKey: IdempotencyKeySchema,
});
const CraftSchema = z.object({
  cardIds: z.array(z.uuid()).min(2).max(10),
  idempotencyKey: IdempotencyKeySchema,
});
const CollectSchema = z.object({
  currency: z.enum(CURRENCIES),
  to: EndpointSchema,
  idempotencyKey: IdempotencyKeySchema,
});
const ChestUpgradeSchema = z.object({
  currency: z.enum(CURRENCIES),
  idempotencyKey: IdempotencyKeySchema,
});
const cardId = new ParseUUIDPipe({ version: undefined, errorHttpStatusCode: HttpStatus.NOT_FOUND });

@Controller('v1')
@RateLimit('mutation')
export class GameController {
  constructor(
    private readonly spins: SpinService,
    private readonly cards: CardsService,
    private readonly shop: ShopService,
    private readonly bonus: BonusService,
    private readonly config: GameConfigService,
    private readonly crafts: CraftService,
    private readonly income: IncomeService,
  ) {}

  /** The whole result is decided here, before any animation (TZ 5.6). */
  @Post('spin')
  @HttpCode(HttpStatus.OK)
  spin(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(SpinSchema)) body: z.infer<typeof SpinSchema>,
  ) {
    return this.spins.spin(user.id, body);
  }

  @Get('cards')
  @RateLimit('default')
  holder(@CurrentUser() user: RequestUser) {
    return this.cards.holder(user.id);
  }

  @Post('cards/:id/hold')
  @HttpCode(HttpStatus.OK)
  hold(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.cards.hold(user.id, id, body.idempotencyKey);
  }

  /** Puts the card into the album as a trophy (D-129). */
  @Post('cards/:id/trophy')
  @HttpCode(HttpStatus.OK)
  trophy(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.cards.toTrophy(user.id, id, body.idempotencyKey);
  }

  /** Removes a trophy from the album for good (D-139). */
  @Post('cards/:id/trophy/remove')
  @HttpCode(HttpStatus.OK)
  removeTrophy(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.cards.removeTrophy(user.id, id, body.idempotencyKey);
  }

  @Post('cards/:id/cashout')
  @HttpCode(HttpStatus.OK)
  cashout(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(CashoutSchema)) body: z.infer<typeof CashoutSchema>,
  ) {
    return this.cards.cashout(user.id, id, body.idempotencyKey, body.toCardId);
  }

  @Post('cards/:id/topup')
  @HttpCode(HttpStatus.OK)
  topup(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(TopupSchema)) body: z.infer<typeof TopupSchema>,
  ) {
    return this.cards.topup(user.id, id, body.amount, body.idempotencyKey);
  }

  @Post('cards/:id/extend')
  @HttpCode(HttpStatus.OK)
  extend(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.cards.extend(user.id, id, body.idempotencyKey);
  }

  @Post('cards/:id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: RequestUser,
    @Param('id', cardId) id: string,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.cards.restore(user.id, id, body.idempotencyKey);
  }

  @Post('holders/buy')
  @HttpCode(HttpStatus.OK)
  buyHolder(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(BuyHolderSchema)) body: z.infer<typeof BuyHolderSchema>,
  ) {
    return this.shop.buyHolder(user.id, body);
  }

  @Post('bonus/daily/claim')
  @HttpCode(HttpStatus.OK)
  claimDaily(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.shop.claimDaily(user.id, body.idempotencyKey);
  }

  @Post('bonus/chest/claim')
  @HttpCode(HttpStatus.OK)
  claimChest(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.bonus.claimChest(user.id, body.idempotencyKey);
  }

  @Get('shop')
  @RateLimit('default')
  async shopItems() {
    return (await this.config.active()).config.shop;
  }

  @Post('shop/buy')
  @HttpCode(HttpStatus.OK)
  buy(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(ShopBuySchema)) body: z.infer<typeof ShopBuySchema>,
  ) {
    return this.bonus.buy(user.id, body);
  }

  @Post('bonus/chest/upgrade')
  @HttpCode(HttpStatus.OK)
  upgradeChest(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(ChestUpgradeSchema)) body: z.infer<typeof ChestUpgradeSchema>,
  ) {
    return this.bonus.upgradeChest(user.id, body.currency, body.idempotencyKey);
  }

  @Post('bonus/wheel/spin')
  @HttpCode(HttpStatus.OK)
  spinWheel(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.bonus.spinWheel(user.id, body.idempotencyKey);
  }

  @Post('cards/cashout-many')
  @HttpCode(HttpStatus.OK)
  cashoutMany(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(CashoutManySchema)) body: z.infer<typeof CashoutManySchema>,
  ) {
    return this.cards.cashoutMany(user.id, body.cardIds, body.idempotencyKey, body.toCardId);
  }

  @Post('cards/hold-many')
  @HttpCode(HttpStatus.OK)
  holdMany(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(HoldManySchema)) body: z.infer<typeof HoldManySchema>,
  ) {
    return this.cards.holdMany(user.id, body.cardIds, body.idempotencyKey);
  }

  @Post('transfers')
  @HttpCode(HttpStatus.OK)
  transfer(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(TransferSchema)) body: z.infer<typeof TransferSchema>,
  ) {
    return this.cards.transfer(user.id, body);
  }

  /** D-174: all other held cards of the currency to one card or the wallet. */
  @Post('transfers/collect')
  @HttpCode(HttpStatus.OK)
  collect(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(CollectSchema)) body: z.infer<typeof CollectSchema>,
  ) {
    return this.cards.collect(user.id, body);
  }

  /** D-170: the chance is rolled here, before the client shows anything. */
  @Post('cards/craft')
  @HttpCode(HttpStatus.OK)
  craft(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(CraftSchema)) body: z.infer<typeof CraftSchema>,
  ) {
    return this.crafts.craft(user.id, body);
  }

  @Post('bonus/album/claim')
  @HttpCode(HttpStatus.OK)
  claimAlbumIncome(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.income.claimAlbumIncome(user.id, body.idempotencyKey);
  }

  @Post('bonus/nick/claim')
  @HttpCode(HttpStatus.OK)
  claimNickBonus(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ) {
    return this.income.claimNickBonus(user.id, body.idempotencyKey);
  }
}
