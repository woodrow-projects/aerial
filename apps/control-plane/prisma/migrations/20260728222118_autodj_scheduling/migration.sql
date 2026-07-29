-- AlterTable
ALTER TABLE "StreamSession" ADD COLUMN "streamerId" TEXT;

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "durationSec" REAL NOT NULL,
    "cueIn" REAL NOT NULL DEFAULT 0,
    "cueOut" REAL,
    "fadeIn" REAL NOT NULL DEFAULT 0,
    "fadeOut" REAL NOT NULL DEFAULT 0,
    "amplifyDb" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "order" TEXT NOT NULL DEFAULT 'shuffle',
    "dedupWindowMin" INTEGER NOT NULL DEFAULT 60,
    "isJingle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlaylistTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Clock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ClockSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clockId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "playlistId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ClockSlot_clockId_fkey" FOREIGN KEY ("clockId") REFERENCES "Clock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClockSlot_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clockId" TEXT,
    "ownerId" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "daysOfWeek" TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    "dateStart" DATETIME,
    "dateEnd" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Show_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Show_clockId_fkey" FOREIGN KEY ("clockId") REFERENCES "Clock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StreamerKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlayLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackId" TEXT,
    "playlistId" TEXT,
    "clockId" TEXT,
    "slotPosition" INTEGER,
    "showId" TEXT,
    "reason" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    CONSTRAINT "PlayLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClockState" (
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "clockId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mount" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deliveryMode" TEXT NOT NULL DEFAULT 'both',
    "harborPort" INTEGER NOT NULL,
    "hlsBitrates" TEXT NOT NULL DEFAULT '[64,128]',
    "icecastBitrate" INTEGER NOT NULL DEFAULT 128,
    "defaultClockId" TEXT,
    "enforceSchedule" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Channel_defaultClockId_fkey" FOREIGN KEY ("defaultClockId") REFERENCES "Clock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Channel" ("createdAt", "deliveryMode", "harborPort", "hlsBitrates", "icecastBitrate", "id", "isActive", "mount", "name", "slug", "updatedAt") SELECT "createdAt", "deliveryMode", "harborPort", "hlsBitrates", "icecastBitrate", "id", "isActive", "mount", "name", "slug", "updatedAt" FROM "Channel";
DROP TABLE "Channel";
ALTER TABLE "new_Channel" RENAME TO "Channel";
CREATE UNIQUE INDEX "Channel_slug_key" ON "Channel"("slug");
CREATE UNIQUE INDEX "Channel_mount_key" ON "Channel"("mount");
CREATE UNIQUE INDEX "Channel_harborPort_key" ON "Channel"("harborPort");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Track_fileName_key" ON "Track"("fileName");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_name_key" ON "Playlist"("name");

-- CreateIndex
CREATE INDEX "PlaylistTrack_playlistId_position_idx" ON "PlaylistTrack"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistTrack_playlistId_trackId_key" ON "PlaylistTrack"("playlistId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "Clock_name_key" ON "Clock"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClockSlot_clockId_position_key" ON "ClockSlot"("clockId", "position");

-- CreateIndex
CREATE INDEX "Show_channelId_idx" ON "Show"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerKey_userId_key" ON "StreamerKey"("userId");

-- CreateIndex
CREATE INDEX "PlayLog_channelId_at_idx" ON "PlayLog"("channelId", "at");
