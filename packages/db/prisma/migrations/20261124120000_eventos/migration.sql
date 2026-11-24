-- CreateEnum
CREATE TYPE "EventParticipationRule" AS ENUM ('SINGLE', 'MULTIPLE');

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "eventId" UUID;

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "bannerUrl" TEXT,
    "ownerId" UUID NOT NULL,
    "participationRule" "EventParticipationRule" NOT NULL DEFAULT 'MULTIPLE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_ownerId_idx" ON "events"("ownerId");

-- CreateIndex
CREATE INDEX "tournaments_eventId_idx" ON "tournaments"("eventId");

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

