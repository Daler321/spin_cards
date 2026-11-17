-- CreateEnum
CREATE TYPE "Region" AS ENUM ('RU', 'US');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('common', 'rare', 'epic', 'legendary', 'mythic');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('active', 'expired', 'pooled', 'cashed');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('wallet', 'card');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('signup_bonus', 'spin_cost', 'cashout', 'daily', 'chest', 'shop', 'referral', 'convert_in', 'convert_out', 'topup', 'restore', 'extend', 'admin_adjust', 'stars_purchase', 'stars_refund');

-- CreateEnum
CREATE TYPE "SpinPaymentSource" AS ENUM ('wallet', 'card', 'free', 'stars');

-- CreateEnum
CREATE TYPE "ConfigStatus" AS ENUM ('draft', 'simulated', 'active', 'archived');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('planned', 'active', 'finished');

-- CreateEnum
CREATE TYPE "LeaderboardType" AS ENUM ('balance', 'collection');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'refunded', 'failed');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('owner', 'analyst', 'support');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "language_code" TEXT,
    "photo_url" TEXT,
    "region" "Region" NOT NULL DEFAULT 'RU',
    "exp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "total_spins" INTEGER NOT NULL DEFAULT 0,
    "return_lucky_pending" BOOLEAN NOT NULL DEFAULT false,
    "referral_code" TEXT NOT NULL,
    "referrer_id" UUID,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "hide_from_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "experiment_group" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "account_type" "LedgerAccountType" NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID,
    "currency" TEXT NOT NULL,
    "delta" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "season_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_conversions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "amount_from" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL,
    "amount_to" BIGINT NOT NULL,
    "rate_nano" BIGINT NOT NULL,
    "rate_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate_nano" BIGINT NOT NULL,
    "fee_bp" INTEGER NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" TEXT,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "region" "Region" NOT NULL,
    "color" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "design" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "owner_id" UUID,
    "bank_id" TEXT NOT NULL,
    "region" "Region" NOT NULL,
    "currency" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "number" CHAR(16) NOT NULL,
    "number_patterns" JSONB NOT NULL,
    "rarity_score" INTEGER NOT NULL,
    "base_limit" BIGINT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "initial_balance" BIGINT NOT NULL,
    "luck_bonus_bp" INTEGER NOT NULL,
    "status" "CardStatus" NOT NULL,
    "owners_count" INTEGER NOT NULL DEFAULT 1,
    "extended_count" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "grace_until" TIMESTAMPTZ(3),
    "pooled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holders" (
    "id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_holders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "holder_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "pack_id" TEXT NOT NULL,
    "payment_source" "SpinPaymentSource" NOT NULL,
    "payment_card_id" UUID,
    "price" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "config_version_id" INTEGER NOT NULL,
    "rolled_params" JSONB NOT NULL,
    "card_id" UUID NOT NULL,
    "lucky" TEXT,
    "pity_applied" TEXT,
    "near_miss" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_counters" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pack_id" TEXT NOT NULL,
    "luck_meter" INTEGER NOT NULL DEFAULT 0,
    "since_rare" INTEGER NOT NULL DEFAULT 0,
    "since_epic" INTEGER NOT NULL DEFAULT 0,
    "since_legendary" INTEGER NOT NULL DEFAULT 0,
    "bad_streak" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_buffs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "boost_bp" INTEGER NOT NULL,
    "spins_left" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_buffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_streaks" (
    "user_id" UUID NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "last_claim_date" DATE,
    "forgiveness_used_at" DATE,

    CONSTRAINT "daily_streaks_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referred_id" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewarded_at" TIMESTAMPTZ(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_config_versions" (
    "id" SERIAL NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ConfigStatus" NOT NULL,
    "simulation_report" JSONB,
    "comment" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),

    CONSTRAINT "game_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "status" "SeasonStatus" NOT NULL,
    "design_set_id" TEXT,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_season_stats" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "spins_count" INTEGER NOT NULL DEFAULT 0,
    "cards_issued" INTEGER NOT NULL DEFAULT 0,
    "best_rarity" INTEGER NOT NULL DEFAULT 0,
    "cashed_out_minor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "user_season_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "type" "LeaderboardType" NOT NULL,
    "user_id" UUID NOT NULL,
    "score" BIGINT NOT NULL,
    "rank" INTEGER NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "star_products" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT,
    "stars_price" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "star_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "stars_amount" INTEGER NOT NULL,
    "telegram_payment_charge_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "season_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT '',
    "value" BIGINT NOT NULL,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications_outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "notifications_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "login" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT,
    "role" "AdminRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "reason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_referrer_id_idx" ON "users"("referrer_id");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_last_seen_at_idx" ON "users"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE INDEX "ledger_entries_account_type_account_id_id_idx" ON "ledger_entries"("account_type", "account_id", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_user_id_created_at_idx" ON "ledger_entries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_reason_created_at_idx" ON "ledger_entries"("reason", "created_at");

-- CreateIndex
CREATE INDEX "currency_conversions_user_id_from_currency_created_at_idx" ON "currency_conversions"("user_id", "from_currency", "created_at");

-- CreateIndex
CREATE INDEX "exchange_rates_from_currency_to_currency_valid_from_idx" ON "exchange_rates"("from_currency", "to_currency", "valid_from" DESC);

-- CreateIndex
CREATE INDEX "cards_owner_id_status_idx" ON "cards"("owner_id", "status");

-- CreateIndex
CREATE INDEX "cards_status_tier_region_pooled_at_idx" ON "cards"("status", "tier", "region", "pooled_at");

-- CreateIndex
CREATE INDEX "cards_expires_at_idx" ON "cards"("expires_at");

-- CreateIndex
CREATE INDEX "cards_number_idx" ON "cards"("number");

-- CreateIndex
CREATE INDEX "user_holders_user_id_idx" ON "user_holders"("user_id");

-- CreateIndex
CREATE INDEX "spins_user_id_created_at_idx" ON "spins"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "spins_season_id_created_at_idx" ON "spins"("season_id", "created_at");

-- CreateIndex
CREATE INDEX "spins_card_id_idx" ON "spins"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_counters_user_id_pack_id_key" ON "user_counters"("user_id", "pack_id");

-- CreateIndex
CREATE INDEX "user_buffs_user_id_spins_left_idx" ON "user_buffs"("user_id", "spins_left");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_id_key" ON "referrals"("referred_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "game_config_versions_status_idx" ON "game_config_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_season_stats_user_id_season_id_key" ON "user_season_stats"("user_id", "season_id");

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_season_id_type_taken_at_idx" ON "leaderboard_snapshots"("season_id", "type", "taken_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_telegram_payment_charge_id_key" ON "payments"("telegram_payment_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "events_name_created_at_idx" ON "events"("name", "created_at");

-- CreateIndex
CREATE INDEX "events_user_id_created_at_idx" ON "events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_date_metric_dimension_key" ON "daily_stats"("date", "metric", "dimension");

-- CreateIndex
CREATE INDEX "notifications_outbox_status_scheduled_at_idx" ON "notifications_outbox"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_login_key" ON "admin_users"("login");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_conversions" ADD CONSTRAINT "currency_conversions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_conversions" ADD CONSTRAINT "currency_conversions_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_holders" ADD CONSTRAINT "user_holders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_holders" ADD CONSTRAINT "user_holders_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "holders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spins" ADD CONSTRAINT "spins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spins" ADD CONSTRAINT "spins_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spins" ADD CONSTRAINT "spins_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spins" ADD CONSTRAINT "spins_config_version_id_fkey" FOREIGN KEY ("config_version_id") REFERENCES "game_config_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_counters" ADD CONSTRAINT "user_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_buffs" ADD CONSTRAINT "user_buffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_streaks" ADD CONSTRAINT "daily_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_season_stats" ADD CONSTRAINT "user_season_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_season_stats" ADD CONSTRAINT "user_season_stats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "star_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications_outbox" ADD CONSTRAINT "notifications_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written constraints (not expressible in schema.prisma) ─────────────

-- A card number belongs to at most one live card (TZ 4.9).
CREATE UNIQUE INDEX "cards_number_live_key" ON "cards" ("number") WHERE "status" IN ('active', 'expired');

-- At most one active game config version.
CREATE UNIQUE INDEX "game_config_versions_single_active_key" ON "game_config_versions" ("status") WHERE "status" = 'active';

-- Card numbers: 16 digits starting with 9.
ALTER TABLE "cards" ADD CONSTRAINT "cards_number_format_check" CHECK ("number" ~ '^9[0-9]{15}$');

-- Balances never go negative; ledger deltas are never zero.
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_nonnegative_check" CHECK ("balance" >= 0);
ALTER TABLE "cards" ADD CONSTRAINT "cards_balance_nonnegative_check" CHECK ("balance" >= 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_delta_nonzero_check" CHECK ("delta" <> 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_balance_after_nonnegative_check" CHECK ("balance_after" >= 0);
ALTER TABLE "currency_conversions" ADD CONSTRAINT "currency_conversions_amounts_check"
  CHECK ("amount_from" > 0 AND "fee" >= 0 AND "amount_to" > 0 AND "from_currency" <> "to_currency");
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_positive_check"
  CHECK ("rate_nano" > 0 AND "fee_bp" BETWEEN 0 AND 10000 AND "from_currency" <> "to_currency");

-- Append-only tables (CLAUDE.md: ledger, spins and payments are never deleted; ledger never changes).
CREATE FUNCTION "reject_modification"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "reject_modification"();
CREATE TRIGGER "spins_no_delete" BEFORE DELETE ON "spins"
  FOR EACH ROW EXECUTE FUNCTION "reject_modification"();
CREATE TRIGGER "payments_no_delete" BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "reject_modification"();
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_modification"();
