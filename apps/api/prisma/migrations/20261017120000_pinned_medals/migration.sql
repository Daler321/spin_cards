-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinned_medals" TEXT[] DEFAULT ARRAY[]::TEXT[];
