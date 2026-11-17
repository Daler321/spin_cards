-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerReason" ADD VALUE 'card_issue';
ALTER TYPE "LedgerReason" ADD VALUE 'card_burn';

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "held_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "free_spins_anchor_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "free_spins_available" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "guaranteed_floor" "Tier";

-- CreateIndex
CREATE INDEX "cards_status_grace_until_idx" ON "cards"("status", "grace_until");
