-- AlterEnum
ALTER TYPE "CardStatus" ADD VALUE 'trophy';
-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'trophy';
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "showcase_slots" INTEGER NOT NULL DEFAULT 0;
