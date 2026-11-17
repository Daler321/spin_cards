-- Chests are counted in spins (D-112): each chest opened so far was worth 10 spins (the period
-- before 2026-10-14), so changing chest.everySpins no longer strands players.
ALTER TABLE "users" ADD COLUMN "chest_spins_used" INTEGER NOT NULL DEFAULT 0;
UPDATE "users" SET "chest_spins_used" = LEAST("chests_claimed" * 10, "total_spins");
ALTER TABLE "users" DROP COLUMN "chests_claimed";
