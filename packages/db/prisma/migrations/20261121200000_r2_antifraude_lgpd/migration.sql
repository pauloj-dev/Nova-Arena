-- R2 (#114 antifraude, #115 LGPD). Só aditiva: colunas anuláveis, tabelas e índices novos.
-- CreateEnum
CREATE TYPE "FraudAlertKind" AS ENUM ('MULTI_ACCOUNT_IP', 'MULTI_ACCOUNT_DEVICE', 'DUPLICATE_GAME_ID', 'MASS_ADMIN_ACTION');

-- CreateEnum
CREATE TYPE "FraudAlertStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "game_accounts" ADD COLUMN     "externalKey" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "deviceId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "guardianConsentAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "fraud_alerts" (
    "id" UUID NOT NULL,
    "kind" "FraudAlertKind" NOT NULL,
    "status" "FraudAlertStatus" NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userIds" UUID[],
    "actorId" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "blobUrl" TEXT,
    "size" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fraud_alerts_status_lastSeenAt_idx" ON "fraud_alerts"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "fraud_alerts_dedupeKey_status_idx" ON "fraud_alerts"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "data_exports_userId_createdAt_idx" ON "data_exports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "data_exports_expiresAt_idx" ON "data_exports"("expiresAt");

-- CreateIndex
CREATE INDEX "game_accounts_gameId_externalKey_idx" ON "game_accounts"("gameId", "externalKey");

-- CreateIndex
CREATE INDEX "sessions_ip_createdAt_idx" ON "sessions"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "sessions_deviceId_createdAt_idx" ON "sessions"("deviceId", "createdAt");


-- Preenche o ID normalizado das contas de jogo que já existem (primeiro campo pedido pelo jogo).
UPDATE "game_accounts" ga
SET "externalKey" = lower(regexp_replace(ga."fields" ->> (g."requiredAccountFields" -> 0 ->> 'key'), '\s', '', 'g'))
FROM "games" g
WHERE g."id" = ga."gameId" AND ga."externalKey" IS NULL AND jsonb_array_length(g."requiredAccountFields") > 0;
