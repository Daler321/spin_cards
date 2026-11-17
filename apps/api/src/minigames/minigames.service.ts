import { HttpStatus, Injectable } from '@nestjs/common';
import {
  actBlackjack,
  type BlackjackAction,
  type BlackjackState,
  blackjackReturnBp,
  BP,
  canDouble,
  dealBlackjack,
  dropBall,
  flipCoin,
  handValue,
  layMines,
  minesMultiplierBp,
  type MinesParams,
  minesSafeChanceBp,
} from '@spincards/game-core';
import {
  type BlackjackActRequest,
  type BlackjackResponse,
  type BlackjackRoundView,
  type BlackjackStartRequest,
  type CoinflipRequest,
  type CoinflipResponse,
  CURRENCIES,
  type Currency,
  ErrorCode,
  type MiniGameDifficulty,
  type MiniGameRoundRequest,
  type MiniGamesConfig,
  type MiniGamesInfo,
  type MinesOpenRequest,
  type MinesResponse,
  type MinesRoundView,
  type MinesStartRequest,
  type PlinkoRequest,
  type PlinkoResponse,
  type WalletBalance,
} from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { cryptoRng } from '../game/crypto-rng.js';
import { lockPlayer } from '../game/player-lock.js';
import {
  LedgerAccountType,
  LedgerReason,
  MiniGame,
  type MiniGameRound,
  MiniGameStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, LedgerService, type Posting } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tx } from '../prisma/prisma.service.js';

/** Hidden part of a mines round; the params are frozen at the start (config edits do not apply). */
interface MinesState extends MinesParams {
  difficulty: MiniGameDifficulty;
  minesAt: number[];
  bonus: number;
  opened: number[];
  bonusStep: number | null;
  exploded: number | null;
}

interface BlackjackRoundState extends BlackjackState {
  baseBet: string;
  blackjackPayoutBp: number;
}

const json = (value: object) => value as Prisma.InputJsonValue;
const payoutOf = (bet: bigint, returnBp: number) => (bet * BigInt(returnBp)) / BigInt(BP);

/**
 * D-169: mini-games for wallet money. Pure chance through crypto randomness: luck, pity and the
 * newcomer boost do not apply. Every bet and payout is a ledger entry inside the round's
 * transaction; mines and 21 keep their hidden state on the server between requests.
 */
@Injectable()
export class MiniGamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
  ) {}

  async info(userId: string): Promise<MiniGamesInfo> {
    const config = await this.openConfig();
    if (!config) return { enabled: false };
    const seasonId = await this.seasons.currentSeasonId();
    await this.expireStale(this.prisma, userId, seasonId);
    const [wallets, rounds] = await Promise.all([
      this.prisma.wallet.findMany({ where: { userId } }),
      this.prisma.miniGameRound.findMany({
        where: { userId, status: MiniGameStatus.active, game: { in: ['mines', 'blackjack'] } },
      }),
    ]);
    const mines = rounds.find((r) => r.game === MiniGame.mines);
    const blackjack = rounds.find((r) => r.game === MiniGame.blackjack);
    return {
      enabled: true,
      maxBetShareBp: config.maxBetShareBp,
      wallets: CURRENCIES.flatMap((currency) => {
        const wallet = wallets.find((w) => w.currency === currency);
        if (!wallet) return [];
        return [
          {
            currency,
            balance: toApiMoney(wallet.balance),
            minBet: config.minBet[currency],
            maxBet: toApiMoney(maxBet(wallet.balance, config)),
          },
        ];
      }),
      mines: config.mines,
      plinko: config.plinko,
      coinflip: config.coinflip,
      blackjack: config.blackjack,
      active: {
        mines: mines ? minesView(mines) : null,
        blackjack: blackjack ? blackjackView(blackjack) : null,
      },
    };
  }

  // ─── Mines ────────────────────────────────────────────────────────────────

  async minesStart(userId: string, request: MinesStartRequest): Promise<MinesResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    const difficulty = config.mines.difficulties.find((d) => d.id === payload.difficulty);
    if (!difficulty || payload.mines < difficulty.minMines || payload.mines > difficulty.maxMines)
      throw new AppError(ErrorCode.MINIGAME_INVALID_MOVE);
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.mines.start', payload },
      async (tx) => {
        await this.beginRound(tx, userId, seasonId, MiniGame.mines);
        const layout = layMines(cryptoRng, difficulty.cells, payload.mines);
        const state: MinesState = {
          difficulty: difficulty.id,
          cells: difficulty.cells,
          mines: payload.mines,
          houseEdgeBp: config.mines.houseEdgeBp,
          bonusBp: config.mines.bonusBp,
          minesAt: layout.mines,
          bonus: layout.bonus,
          opened: [],
          bonusStep: null,
          exploded: null,
        };
        const round = await this.createRound(tx, {
          userId,
          seasonId,
          game: MiniGame.mines,
          currency: payload.currency,
          bet: BigInt(payload.bet),
          state,
        });
        const wallet = await this.settle(tx, userId, round, config, seasonId, {
          bet: BigInt(payload.bet),
          checkLimit: true,
        });
        return { round: minesView(round), wallet };
      },
    );
  }

  async minesOpen(userId: string, request: MinesOpenRequest): Promise<MinesResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.mines.open', payload },
      async (tx) => {
        const round = await this.activeRound(tx, userId, seasonId, payload.roundId, MiniGame.mines);
        const state = round.state as unknown as MinesState;
        if (payload.cell < 0 || payload.cell >= state.cells || state.opened.includes(payload.cell))
          throw new AppError(ErrorCode.MINIGAME_INVALID_MOVE, HttpStatus.CONFLICT);
        if (state.minesAt.includes(payload.cell)) {
          state.exploded = payload.cell;
          const lost = await this.update(tx, round, state, MiniGameStatus.finished, 0n);
          return { round: minesView(lost), wallet: await this.walletOf(tx, userId, round) };
        }
        state.opened.push(payload.cell);
        if (payload.cell === state.bonus) state.bonusStep = state.opened.length;
        // Every safe cell open: the money is taken automatically.
        if (state.opened.length === state.cells - state.mines)
          return this.minesPay(tx, userId, round, state, config, seasonId);
        const updated = await this.update(tx, round, state, MiniGameStatus.active, 0n);
        return { round: minesView(updated), wallet: await this.walletOf(tx, userId, round) };
      },
    );
  }

  async minesCashout(userId: string, request: MiniGameRoundRequest): Promise<MinesResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.mines.cashout', payload },
      async (tx) => {
        const round = await this.activeRound(tx, userId, seasonId, payload.roundId, MiniGame.mines);
        const state = round.state as unknown as MinesState;
        if (state.opened.length === 0)
          throw new AppError(ErrorCode.MINIGAME_INVALID_MOVE, HttpStatus.CONFLICT);
        return this.minesPay(tx, userId, round, state, config, seasonId);
      },
    );
  }

  private async minesPay(
    tx: Tx,
    userId: string,
    round: MiniGameRound,
    state: MinesState,
    config: MiniGamesConfig,
    seasonId: string,
  ): Promise<MinesResponse> {
    const multiplier = minesMultiplierBp(state, state.opened.length, state.bonusStep);
    const payout = payoutOf(round.bet, multiplier);
    const finished = await this.update(tx, round, state, MiniGameStatus.finished, payout);
    const wallet = await this.settle(tx, userId, finished, config, seasonId, { payout });
    return { round: minesView(finished), wallet };
  }

  // ─── Plinko and the coin: one request, one finished round ─────────────────

  async plinko(userId: string, request: PlinkoRequest): Promise<PlinkoResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    const board = config.plinko.difficulties.find((d) => d.id === payload.difficulty);
    if (!board || payload.balls > config.plinko.maxBalls)
      throw new AppError(ErrorCode.MINIGAME_INVALID_MOVE);
    if (payload.betPerBall < config.minBet[payload.currency])
      throw new AppError(ErrorCode.MINIGAME_BET_TOO_LOW);
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.plinko', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const perBall = BigInt(payload.betPerBall);
        const balls = Array.from({ length: payload.balls }, () => {
          const ball = dropBall(cryptoRng, board.rows);
          const multiplierBp = board.multipliersBp[ball.cup] ?? 0;
          return { ...ball, multiplierBp, payout: payoutOf(perBall, multiplierBp) };
        });
        const bet = perBall * BigInt(payload.balls);
        const payout = balls.reduce((sum, ball) => sum + ball.payout, 0n);
        const round = await this.createRound(tx, {
          userId,
          seasonId,
          game: MiniGame.plinko,
          currency: payload.currency,
          bet,
          payout,
          status: MiniGameStatus.finished,
          state: { difficulty: board.id, rows: board.rows, balls },
        });
        const wallet = await this.settle(tx, userId, round, config, seasonId, {
          bet,
          payout,
          checkLimit: true,
        });
        return {
          roundId: round.id,
          rows: board.rows,
          balls: balls.map((ball) => ({ ...ball, payout: toApiMoney(ball.payout) })),
          bet: toApiMoney(bet),
          payout: toApiMoney(payout),
          wallet,
        };
      },
    );
  }

  async coinflip(userId: string, request: CoinflipRequest): Promise<CoinflipResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.coinflip', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const result = flipCoin(cryptoRng);
        const bet = BigInt(payload.bet);
        const payout = result === payload.side ? payoutOf(bet, config.coinflip.payoutBp) : 0n;
        const round = await this.createRound(tx, {
          userId,
          seasonId,
          game: MiniGame.coinflip,
          currency: payload.currency,
          bet,
          payout,
          status: MiniGameStatus.finished,
          state: { side: payload.side, result },
        });
        const wallet = await this.settle(tx, userId, round, config, seasonId, {
          bet,
          payout,
          checkLimit: true,
        });
        return {
          roundId: round.id,
          side: payload.side,
          result,
          bet: toApiMoney(bet),
          payout: toApiMoney(payout),
          wallet,
        };
      },
    );
  }

  // ─── 21 ───────────────────────────────────────────────────────────────────

  async blackjackStart(userId: string, request: BlackjackStartRequest): Promise<BlackjackResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.blackjack.start', payload },
      async (tx) => {
        await this.beginRound(tx, userId, seasonId, MiniGame.blackjack);
        const bet = BigInt(payload.bet);
        const state: BlackjackRoundState = {
          ...dealBlackjack(cryptoRng, config.blackjack.decks),
          baseBet: bet.toString(),
          blackjackPayoutBp: config.blackjack.blackjackPayoutBp,
        };
        const payout = blackjackPayout(state);
        const round = await this.createRound(tx, {
          userId,
          seasonId,
          game: MiniGame.blackjack,
          currency: payload.currency,
          bet,
          payout,
          status: state.outcome === null ? MiniGameStatus.active : MiniGameStatus.finished,
          state,
        });
        const wallet = await this.settle(tx, userId, round, config, seasonId, {
          bet,
          payout,
          checkLimit: true,
        });
        return { round: blackjackView(round), wallet };
      },
    );
  }

  async blackjackAct(userId: string, request: BlackjackActRequest): Promise<BlackjackResponse> {
    const { config, seasonId } = await this.settings();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'minigames.blackjack.act', payload },
      async (tx) => {
        const round = await this.activeRound(
          tx,
          userId,
          seasonId,
          payload.roundId,
          MiniGame.blackjack,
        );
        const state = round.state as unknown as BlackjackRoundState;
        const action: BlackjackAction = payload.action;
        if (action === 'double' && !canDouble(state))
          throw new AppError(ErrorCode.MINIGAME_INVALID_MOVE, HttpStatus.CONFLICT);
        // The double stakes the base bet once more; only the wallet balance limits it.
        const extra = action === 'double' ? BigInt(state.baseBet) : 0n;
        actBlackjack(state, action);
        const over = state.outcome !== null;
        const payout = over ? blackjackPayout(state) : 0n;
        const updated = await tx.miniGameRound.update({
          where: { id: round.id },
          data: {
            state: json(state),
            bet: round.bet + extra,
            payout,
            status: over ? MiniGameStatus.finished : MiniGameStatus.active,
            finishedAt: over ? new Date() : null,
          },
        });
        const wallet = await this.settle(tx, userId, updated, config, seasonId, {
          bet: extra,
          payout,
        });
        return { round: blackjackView(updated), wallet };
      },
    );
  }

  // ─── Shared steps ─────────────────────────────────────────────────────────

  private async openConfig(): Promise<MiniGamesConfig | null> {
    if (!(await this.flags.isEnabled('minigames_enabled'))) return null;
    return (await this.config.active()).config.minigames ?? null;
  }

  private async settings(): Promise<{ config: MiniGamesConfig; seasonId: string }> {
    await this.flags.assertNotMaintenance();
    const config = await this.openConfig();
    if (!config) throw new AppError(ErrorCode.NOT_AVAILABLE, HttpStatus.CONFLICT);
    return { config, seasonId: await this.seasons.currentSeasonId() };
  }

  /** Locks the player; one open round per interactive game. */
  private async beginRound(tx: Tx, userId: string, seasonId: string, game: MiniGame) {
    await lockPlayer(tx, userId);
    await this.expireStale(tx, userId, seasonId);
    const open = await tx.miniGameRound.count({
      where: { userId, game, status: MiniGameStatus.active },
    });
    if (open > 0) throw new AppError(ErrorCode.MINIGAME_ROUND_ACTIVE, HttpStatus.CONFLICT);
  }

  private async activeRound(
    tx: Tx,
    userId: string,
    seasonId: string,
    roundId: string,
    game: MiniGame,
  ): Promise<MiniGameRound> {
    await lockPlayer(tx, userId);
    await this.expireStale(tx, userId, seasonId);
    const round = await tx.miniGameRound.findFirst({ where: { id: roundId, userId, game } });
    if (!round) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    if (round.status !== MiniGameStatus.active)
      throw new AppError(ErrorCode.MINIGAME_ROUND_OVER, HttpStatus.CONFLICT);
    return round;
  }

  /**
   * A round left open over a season change is closed unpaid: its stake was wiped with the
   * season's money (D-132), paying it into the new season would carry money over.
   */
  private async expireStale(db: Pick<Tx, 'miniGameRound'>, userId: string, seasonId: string) {
    await db.miniGameRound.updateMany({
      where: { userId, status: MiniGameStatus.active, seasonId: { not: seasonId } },
      data: { status: MiniGameStatus.expired, finishedAt: new Date() },
    });
  }

  private createRound(
    tx: Tx,
    data: {
      userId: string;
      seasonId: string;
      game: MiniGame;
      currency: Currency;
      bet: bigint;
      payout?: bigint;
      status?: MiniGameStatus;
      state: object;
    },
  ): Promise<MiniGameRound> {
    const finished = data.status === MiniGameStatus.finished;
    return tx.miniGameRound.create({
      data: { ...data, state: json(data.state), finishedAt: finished ? new Date() : null },
    });
  }

  private update(
    tx: Tx,
    round: MiniGameRound,
    state: object,
    status: MiniGameStatus,
    payout: bigint,
  ): Promise<MiniGameRound> {
    return tx.miniGameRound.update({
      where: { id: round.id },
      data: {
        state: json(state),
        status,
        payout,
        finishedAt: status === MiniGameStatus.active ? null : new Date(),
      },
    });
  }

  /**
   * Posts the stake and the payout of a round to the wallet. With checkLimit the stake must lie in
   * [minBet, maxBetShareBp of the balance]; the player is locked, so the balance read is current.
   */
  private async settle(
    tx: Tx,
    userId: string,
    round: MiniGameRound,
    config: MiniGamesConfig,
    seasonId: string,
    money: { bet?: bigint; payout?: bigint; checkLimit?: boolean },
  ): Promise<WalletBalance> {
    const currency = round.currency as Currency;
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId, currency } },
    });
    const bet = money.bet ?? 0n;
    if (money.checkLimit) {
      const perBet = round.game === MiniGame.plinko ? null : bet;
      if (perBet !== null && perBet < BigInt(config.minBet[currency]))
        throw new AppError(ErrorCode.MINIGAME_BET_TOO_LOW);
      if (bet > maxBet(wallet.balance, config))
        throw new AppError(ErrorCode.MINIGAME_BET_TOO_HIGH, HttpStatus.CONFLICT);
    }
    const walletRef = { type: LedgerAccountType.wallet, id: wallet.id };
    const ref = { type: `minigame_${round.game}`, id: round.id };
    const postings: Posting[] = [
      { account: walletRef, delta: -bet, reason: LedgerReason.minigame_bet, ref },
      { account: walletRef, delta: money.payout ?? 0n, reason: LedgerReason.minigame_win, ref },
    ];
    const balances = await this.ledger.post(tx, postings, { seasonId });
    return {
      currency,
      balance: toApiMoney(balances.get(accountKey(walletRef)) ?? wallet.balance),
    };
  }

  private async walletOf(tx: Tx, userId: string, round: MiniGameRound): Promise<WalletBalance> {
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId, currency: round.currency } },
    });
    return { currency: round.currency, balance: toApiMoney(wallet.balance) };
  }
}

function maxBet(balance: bigint, config: MiniGamesConfig): bigint {
  return (balance * BigInt(config.maxBetShareBp)) / BigInt(BP);
}

function blackjackPayout(state: BlackjackRoundState): bigint {
  if (state.outcome === null) return 0n;
  return payoutOf(BigInt(state.baseBet), blackjackReturnBp(state, state.blackjackPayoutBp));
}

export function minesView(round: MiniGameRound): MinesRoundView {
  const state = round.state as unknown as MinesState;
  const over = round.status !== MiniGameStatus.active;
  const opened = state.opened.length;
  const safeLeft = state.cells - state.mines - opened;
  return {
    id: round.id,
    status: round.status,
    currency: round.currency,
    bet: toApiMoney(round.bet),
    difficulty: state.difficulty,
    cells: state.cells,
    mines: state.mines,
    opened: state.opened,
    bonusCell: over || state.bonusStep !== null ? state.bonus : null,
    bonusFound: state.bonusStep !== null,
    multiplierBp: opened === 0 ? 0 : minesMultiplierBp(state, opened, state.bonusStep),
    nextMultiplierBp: safeLeft > 0 ? minesMultiplierBp(state, opened + 1, state.bonusStep) : null,
    safeChanceBp: minesSafeChanceBp(state.cells, state.mines, opened),
    exploded: state.exploded,
    minesAt: over ? state.minesAt : null,
    payout: toApiMoney(round.payout),
  };
}

export function blackjackView(round: MiniGameRound): BlackjackRoundView {
  const state = round.state as unknown as BlackjackRoundState;
  const over = round.status !== MiniGameStatus.active;
  return {
    id: round.id,
    status: round.status,
    currency: round.currency,
    bet: toApiMoney(round.bet),
    player: state.player,
    dealer: over ? state.dealer : state.dealer.slice(0, 1),
    playerTotal: handValue(state.player).total,
    dealerTotal: over ? handValue(state.dealer).total : null,
    canDouble: !over && canDouble(state),
    outcome: state.outcome,
    payout: toApiMoney(round.payout),
  };
}
