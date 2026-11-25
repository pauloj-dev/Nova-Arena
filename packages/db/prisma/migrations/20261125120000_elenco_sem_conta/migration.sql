-- Elenco sem conta (RN-18): jogadores que a organização coloca no elenco de uma inscrição criada por ela
-- (planilha ou cadastro manual). Só cria tabela e índices: nada muda nas inscrições que já existem.

-- CreateTable
CREATE TABLE "registration_guests" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gameId" TEXT,
    "isSub" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registration_guests_registrationId_idx" ON "registration_guests"("registrationId");

-- CreateIndex
CREATE INDEX "registration_guests_tournamentId_gameId_idx" ON "registration_guests"("tournamentId", "gameId");

-- AddForeignKey
ALTER TABLE "registration_guests" ADD CONSTRAINT "registration_guests_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
