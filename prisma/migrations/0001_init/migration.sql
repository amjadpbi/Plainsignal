-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'PRO');

-- CreateEnum
CREATE TYPE "NicheVerdict" AS ENUM ('STRONG', 'PROMISING', 'CROWDED', 'AVOID');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "supabase_auth_id" TEXT,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "etsy_shop_id" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "searches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "seed_keyword" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_snapshots" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "competition_count" INTEGER NOT NULL,
    "avg_favorites" DOUBLE PRECISION NOT NULL,
    "price_min" DOUBLE PRECISION,
    "price_med" DOUBLE PRECISION,
    "price_max" DOUBLE PRECISION,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_id" TEXT,

    CONSTRAINT "keyword_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_scores" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "demand" DOUBLE PRECISION NOT NULL,
    "opportunity" DOUBLE PRECISION NOT NULL,
    "verdict" "NicheVerdict" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_runs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "findings_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_supabase_auth_id_key" ON "users"("supabase_auth_id");

-- CreateIndex
CREATE INDEX "shops_user_id_idx" ON "shops"("user_id");

-- CreateIndex
CREATE INDEX "searches_user_id_idx" ON "searches"("user_id");

-- CreateIndex
CREATE INDEX "searches_user_id_created_at_idx" ON "searches"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "keyword_snapshots_keyword_captured_at_idx" ON "keyword_snapshots"("keyword", "captured_at");

-- CreateIndex
CREATE INDEX "keyword_snapshots_search_id_idx" ON "keyword_snapshots"("search_id");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_scores_snapshot_id_key" ON "keyword_scores"("snapshot_id");

-- CreateIndex
CREATE INDEX "audit_runs_shop_id_idx" ON "audit_runs"("shop_id");

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_snapshots" ADD CONSTRAINT "keyword_snapshots_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "searches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_scores" ADD CONSTRAINT "keyword_scores_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "keyword_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

