-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'p2p';
-- CreateTable
CREATE TABLE "player_transfers" (
    "id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "player_transfers_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "player_transfers_from_user_id_created_at_idx" ON "player_transfers"("from_user_id", "created_at");
-- CreateIndex
CREATE INDEX "player_transfers_to_user_id_created_at_idx" ON "player_transfers"("to_user_id", "created_at");
-- AddForeignKey
ALTER TABLE "player_transfers" ADD CONSTRAINT "player_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "player_transfers" ADD CONSTRAINT "player_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Recipients are found by @username, case-insensitively.
CREATE INDEX "users_username_lower_idx" ON "users" (lower("username"));
