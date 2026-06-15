-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mount" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "harborPort" INTEGER NOT NULL,
    "hlsBitrates" INTEGER[] DEFAULT ARRAY[64, 128]::INTEGER[],
    "icecastBitrate" INTEGER NOT NULL DEFAULT 128,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamKey" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "StreamKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamSession" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "mount" TEXT NOT NULL,
    "sourceIp" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_slug_key" ON "Channel"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_mount_key" ON "Channel"("mount");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_harborPort_key" ON "Channel"("harborPort");

-- CreateIndex
CREATE INDEX "StreamKey_channelId_idx" ON "StreamKey"("channelId");

-- CreateIndex
CREATE INDEX "StreamSession_channelId_idx" ON "StreamSession"("channelId");

-- AddForeignKey
ALTER TABLE "StreamKey" ADD CONSTRAINT "StreamKey_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
