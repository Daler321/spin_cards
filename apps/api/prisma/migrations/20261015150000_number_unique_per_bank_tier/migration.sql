-- D-123: a card number is unique among live cards of one bank and tier (it used to be unique
-- across the whole game). Partial unique indexes are not expressible in schema.prisma.
DROP INDEX "cards_number_live_key";
CREATE UNIQUE INDEX "cards_number_live_key" ON "cards" ("bank_id", "tier", "number") WHERE "status" IN ('active', 'expired');
