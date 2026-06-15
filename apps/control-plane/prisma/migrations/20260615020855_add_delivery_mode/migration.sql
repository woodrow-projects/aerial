-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('hls', 'icecast', 'both');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'both';
