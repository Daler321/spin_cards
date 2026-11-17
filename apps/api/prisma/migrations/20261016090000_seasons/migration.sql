-- AlterEnum
ALTER TYPE "LeaderboardType" ADD VALUE 'season';
-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'season_reward';
-- AlterTable
ALTER TABLE "user_season_stats" ADD COLUMN     "points" BIGINT NOT NULL DEFAULT 0;
-- CreateTable
CREATE TABLE "season_results" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" BIGINT NOT NULL,
    "reward" BIGINT,
    "currency" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "season_results_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "season_results_user_id_idx" ON "season_results"("user_id");
-- CreateIndex
CREATE UNIQUE INDEX "season_results_season_id_user_id_key" ON "season_results"("season_id", "user_id");
-- AddForeignKey
ALTER TABLE "season_results" ADD CONSTRAINT "season_results_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "season_results" ADD CONSTRAINT "season_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Backfill: season points of earlier spins (the rarity of each dropped card).
UPDATE "user_season_stats" s SET "points" = x.points
FROM (
  SELECT sp."user_id", sp."season_id", SUM(c."rarity_score")::bigint AS points
  FROM "spins" sp JOIN "cards" c ON c."id" = sp."card_id"
  GROUP BY sp."user_id", sp."season_id"
) x
WHERE s."user_id" = x."user_id" AND s."season_id" = x."season_id";
