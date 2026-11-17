-- CreateTable
CREATE TABLE "game_config_experiments" (
    "group" TEXT NOT NULL,
    "version_id" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_config_experiments_pkey" PRIMARY KEY ("group")
);

-- AddForeignKey
ALTER TABLE "game_config_experiments" ADD CONSTRAINT "game_config_experiments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "game_config_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

