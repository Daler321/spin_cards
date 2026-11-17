-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "spin_window_started_at" TIMESTAMPTZ(3),
ADD COLUMN     "spins_in_window" INTEGER NOT NULL DEFAULT 0;
