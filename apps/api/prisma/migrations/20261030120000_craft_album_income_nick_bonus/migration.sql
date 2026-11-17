-- AlterEnum
ALTER TYPE "CardStatus" ADD VALUE 'crafted';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerReason" ADD VALUE 'craft_fee';
ALTER TYPE "LedgerReason" ADD VALUE 'card_upgrade';
ALTER TYPE "LedgerReason" ADD VALUE 'album_income';
ALTER TYPE "LedgerReason" ADD VALUE 'nick_bonus';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "album_income_at" TIMESTAMPTZ(3),
ADD COLUMN     "auto_cashout_tiers" "Tier"[] DEFAULT ARRAY[]::"Tier"[],
ADD COLUMN     "nick_bonus_at" TIMESTAMPTZ(3),
ADD COLUMN     "nick_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "nick_has_tag" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "card_crafts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "tier" "Tier" NOT NULL,
    "input_card_ids" UUID[],
    "success" BOOLEAN NOT NULL,
    "result_card_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "fee" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_crafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_crafts_user_id_created_at_idx" ON "card_crafts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "card_crafts_season_id_created_at_idx" ON "card_crafts"("season_id", "created_at");

-- AddForeignKey
ALTER TABLE "card_crafts" ADD CONSTRAINT "card_crafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_crafts" ADD CONSTRAINT "card_crafts_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

