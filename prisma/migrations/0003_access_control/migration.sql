-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'DISABLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "access_requested_at" TIMESTAMP(3),
ADD COLUMN     "active_device_id" TEXT,
ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pending_device_id" TEXT,
ADD COLUMN     "plan_status" "PlanStatus" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

