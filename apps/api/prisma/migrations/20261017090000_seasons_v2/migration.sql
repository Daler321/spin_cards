-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "LedgerReason" ADD VALUE 'season_reset';
ALTER TYPE "LedgerReason" ADD VALUE 'season_start';
ALTER TYPE "LedgerReason" ADD VALUE 'achievement';
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "money_season_id" UUID;
-- CreateTable
CREATE TABLE "user_achievements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "season_name" TEXT,
    "earned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_user_id_achievement_id_scope_key" ON "user_achievements"("user_id", "achievement_id", "scope");
-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Everyone's money belongs to the season that is running now (no reset at deploy).
UPDATE "users" SET "money_season_id" = (
  SELECT "id" FROM "seasons" WHERE "status" = 'active' ORDER BY "starts_at" DESC LIMIT 1
);
