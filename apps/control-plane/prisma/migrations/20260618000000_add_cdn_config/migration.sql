-- CreateEnum
CREATE TYPE "CdnProvider" AS ENUM ('bunny');

-- CreateEnum
CREATE TYPE "CdnStatus" AS ENUM ('disabled', 'provisioning', 'active', 'error');

-- CreateTable
CREATE TABLE "CdnConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" "CdnProvider" NOT NULL DEFAULT 'bunny',
    "status" "CdnStatus" NOT NULL DEFAULT 'disabled',
    "pullZoneId" TEXT,
    "cdnHostname" TEXT,
    "apiKeyEnc" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CdnConfig_pkey" PRIMARY KEY ("id")
);
