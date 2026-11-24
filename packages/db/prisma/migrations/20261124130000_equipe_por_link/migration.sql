-- Convite por link para a equipe de um campeonato (co-organizador ou moderador). Só o hash do token fica no banco.

-- CreateTable
CREATE TABLE "tournament_staff_invites" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_staff_invites_tokenHash_key" ON "tournament_staff_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "tournament_staff_invites_tournamentId_idx" ON "tournament_staff_invites"("tournamentId");

-- AddForeignKey
ALTER TABLE "tournament_staff_invites" ADD CONSTRAINT "tournament_staff_invites_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
