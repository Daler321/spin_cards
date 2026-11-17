-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'minigame_bet';
ALTER TYPE "LedgerReason" ADD VALUE 'minigame_win';

-- CreateEnum
CREATE TYPE "MiniGame" AS ENUM ('mines', 'plinko', 'coinflip', 'blackjack');

-- CreateEnum
CREATE TYPE "MiniGameStatus" AS ENUM ('active', 'finished', 'expired');

-- CreateTable
CREATE TABLE "mini_game_rounds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "game" "MiniGame" NOT NULL,
    "currency" TEXT NOT NULL,
    "bet" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL DEFAULT 0,
    "status" "MiniGameStatus" NOT NULL DEFAULT 'active',
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "mini_game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mini_game_rounds_user_id_game_status_idx" ON "mini_game_rounds"("user_id", "game", "status");

-- CreateIndex
CREATE INDEX "mini_game_rounds_season_id_created_at_idx" ON "mini_game_rounds"("season_id", "created_at");

-- AddForeignKey
ALTER TABLE "mini_game_rounds" ADD CONSTRAINT "mini_game_rounds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_game_rounds" ADD CONSTRAINT "mini_game_rounds_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
