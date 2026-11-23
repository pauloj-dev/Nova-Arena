-- Pós-lançamento B (issues 121 e 125). Só mudanças aditivas: compatível com a versão anterior.
--
-- 1. Novo alvo de denúncia: mensagem do chat da partida.
-- 2. discord_links: vínculo de um campeonato com um servidor do Discord (bot de avisos e check-in).
-- 3. match_chat_messages: chat por partida entre jogadores e organização.

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'CHAT_MESSAGE';

-- CreateTable
CREATE TABLE "discord_links" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMPTZ(3),
    "guildId" TEXT,
    "guildName" TEXT,
    "channelId" TEXT,
    "linkedById" UUID,
    "linkedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "lastAnnouncementAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discord_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_chat_messages" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hiddenAt" TIMESTAMPTZ(3),
    "hiddenById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_links_tournamentId_key" ON "discord_links"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_links_codeHash_key" ON "discord_links"("codeHash");

-- CreateIndex
CREATE INDEX "discord_links_guildId_idx" ON "discord_links"("guildId");

-- CreateIndex
CREATE INDEX "match_chat_messages_matchId_createdAt_idx" ON "match_chat_messages"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "match_chat_messages_authorId_createdAt_idx" ON "match_chat_messages"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_chat_messages" ADD CONSTRAINT "match_chat_messages_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

