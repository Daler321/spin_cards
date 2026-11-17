-- D-147: luck points and Stars multipliers instead of percentage buffs.
ALTER TABLE "user_buffs" ADD COLUMN     "luck_points" INTEGER,
ADD COLUMN     "multiplier_bp" INTEGER,
ALTER COLUMN "boost_bp" DROP NOT NULL,
ALTER COLUMN "spins_left" DROP NOT NULL;

-- Bonuses still running keep about the same strength as luck points.
UPDATE "user_buffs" SET "luck_points" = GREATEST(1, "boost_bp" / 100) WHERE "boost_bp" IS NOT NULL;
