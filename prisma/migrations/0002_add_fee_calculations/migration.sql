-- CreateTable
CREATE TABLE "fee_calculations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "item_cost" DOUBLE PRECISION NOT NULL,
    "shipping_cost" DOUBLE PRECISION NOT NULL,
    "sale_price" DOUBLE PRECISION NOT NULL,
    "shipping_charged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL,
    "total_fees" DOUBLE PRECISION NOT NULL,
    "net_profit" DOUBLE PRECISION NOT NULL,
    "margin_pct" DOUBLE PRECISION NOT NULL,
    "breakdown_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_calculations_user_id_idx" ON "fee_calculations"("user_id");

-- CreateIndex
CREATE INDEX "fee_calculations_user_id_created_at_idx" ON "fee_calculations"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "fee_calculations" ADD CONSTRAINT "fee_calculations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

