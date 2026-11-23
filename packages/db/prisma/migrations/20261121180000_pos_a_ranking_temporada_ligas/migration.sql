-- Pós-lançamento (issue #120, ADR-0003): temporadas do ranking e ligas semanais. Só cria tabelas novas:
-- compatível com a versão anterior do código.
-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "gameId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "placementPoints" JSONB NOT NULL,
    "participationPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_tournaments" (
    "leagueId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_tournaments_pkey" PRIMARY KEY ("leagueId","tournamentId")
);

-- CreateIndex
CREATE INDEX "seasons_gameId_startsAt_idx" ON "seasons"("gameId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_slug_key" ON "leagues"("slug");

-- CreateIndex
CREATE INDEX "leagues_ownerId_idx" ON "leagues"("ownerId");

-- CreateIndex
CREATE INDEX "leagues_gameId_idx" ON "leagues"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "league_tournaments_tournamentId_key" ON "league_tournaments"("tournamentId");

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_tournaments" ADD CONSTRAINT "league_tournaments_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_tournaments" ADD CONSTRAINT "league_tournaments_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

