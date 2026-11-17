-- CreateEnum
CREATE TYPE "QuestKind" AS ENUM ('daily', 'season');
-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'quest';
-- CreateTable
CREATE TABLE "quest_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "kind" "QuestKind" NOT NULL,
    "period" TEXT NOT NULL,
    "quest_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "tier" "Tier",
    "reward" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMPTZ(3),
    "claimed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quest_progress_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "quest_progress_user_id_period_idx" ON "quest_progress"("user_id", "period");
-- CreateIndex
CREATE UNIQUE INDEX "quest_progress_user_id_kind_period_quest_id_key" ON "quest_progress"("user_id", "kind", "period", "quest_id");
-- AddForeignKey
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
