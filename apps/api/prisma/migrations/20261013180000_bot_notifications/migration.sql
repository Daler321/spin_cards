-- AlterTable
ALTER TABLE "notifications_outbox" ADD COLUMN     "broadcast_id" UUID,
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bot_blocked_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "segment_days" INTEGER,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_outbox_dedupe_key_key" ON "notifications_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_outbox_broadcast_id_status_idx" ON "notifications_outbox"("broadcast_id", "status");

-- AddForeignKey
ALTER TABLE "notifications_outbox" ADD CONSTRAINT "notifications_outbox_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

