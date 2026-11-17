-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'wheel';

-- AlterTable
ALTER TABLE "user_buffs" ADD COLUMN     "pack_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "chest_level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "wheel_spun_at" TIMESTAMPTZ(3);
