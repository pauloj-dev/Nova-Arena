-- Administração e moderação do B2 (issues #91, #92, #93, #96, #101). Só acrescenta: colunas novas nulas ou com
-- padrão, duas tabelas novas e índices em tabelas pequenas. Compatível com a versão anterior.

-- AlterTable
ALTER TABLE "admin_removal_requests" ADD COLUMN     "decidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endsAt" TIMESTAMPTZ(3),
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "recipients" INTEGER,
ADD COLUMN     "startsAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "targetLabel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "targetLink" TEXT,
ADD COLUMN     "targetOwnerUserId" UUID;

-- CreateTable
CREATE TABLE "orphan_tournaments" (
    "tournamentId" UUID NOT NULL,
    "previousOwnerId" UUID NOT NULL,
    "previousStatus" "TournamentStatus" NOT NULL,
    "cause" TEXT NOT NULL,
    "since" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orphan_tournaments_pkey" PRIMARY KEY ("tournamentId")
);

-- CreateTable
CREATE TABLE "product_events" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "userId" UUID,
    "props" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orphan_tournaments_since_idx" ON "orphan_tournaments"("since");

-- CreateIndex
CREATE INDEX "product_events_name_createdAt_idx" ON "product_events"("name", "createdAt");

-- CreateIndex
CREATE INDEX "product_events_userId_createdAt_idx" ON "product_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "announcements_kind_active_idx" ON "announcements"("kind", "active");

-- CreateIndex
CREATE INDEX "reports_reporterId_createdAt_idx" ON "reports"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_targetOwnerUserId_idx" ON "reports"("targetOwnerUserId");

-- CreateIndex
CREATE INDEX "sanctions_type_endsAt_idx" ON "sanctions"("type", "endsAt");
