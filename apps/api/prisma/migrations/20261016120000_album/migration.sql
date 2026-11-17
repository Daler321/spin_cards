-- AlterEnum
ALTER TYPE "LeaderboardType" ADD VALUE 'album';
-- CreateTable
CREATE TABLE "album_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "card_number" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "first_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_entries_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "album_entries_user_id_key_key" ON "album_entries"("user_id", "key");
-- AddForeignKey
ALTER TABLE "album_entries" ADD CONSTRAINT "album_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Backfill from earlier spins: the first card of each bank and tier, and of each pattern.
INSERT INTO "album_entries" ("id", "user_id", "key", "card_number", "season_id", "first_at")
SELECT gen_random_uuid(), x.user_id, x.key, x.number, x.season_id, x.created_at
FROM (
  SELECT DISTINCT ON (sp."user_id", 'bank:' || c."bank_id" || ':' || c."tier")
    sp."user_id", 'bank:' || c."bank_id" || ':' || c."tier" AS key, c."number",
    sp."season_id", sp."created_at"
  FROM "spins" sp JOIN "cards" c ON c."id" = sp."card_id"
  ORDER BY sp."user_id", 'bank:' || c."bank_id" || ':' || c."tier", sp."created_at"
) x
ON CONFLICT ("user_id", "key") DO NOTHING;

INSERT INTO "album_entries" ("id", "user_id", "key", "card_number", "season_id", "first_at")
SELECT gen_random_uuid(), x.user_id, x.key, x.number, x.season_id, x.created_at
FROM (
  SELECT DISTINCT ON (sp."user_id", p.value ->> 'id')
    sp."user_id", 'pattern:' || (p.value ->> 'id') AS key, c."number", sp."season_id", sp."created_at"
  FROM "spins" sp
  JOIN "cards" c ON c."id" = sp."card_id"
  CROSS JOIN LATERAL jsonb_array_elements(c."number_patterns") AS p(value)
  ORDER BY sp."user_id", p.value ->> 'id', sp."created_at"
) x
ON CONFLICT ("user_id", "key") DO NOTHING;
