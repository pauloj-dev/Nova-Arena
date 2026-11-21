-- Resultados, pódio e disputas (B2: issues #85, #86, #88, #90). Só mudanças aditivas: compatível com a versão anterior.
--
-- 1. `result_events.actorId` passa a aceitar nulo (W.O. automático é ação do sistema) e a tabela vira somente
--    inserção, como a auditoria: gatilhos recusam UPDATE, DELETE e TRUNCATE (o histórico do resultado é imutável).
-- 2. `tournament_podiums`: 1º, 2º e 3º do campeonato encerrado.
-- 3. Colunas novas (nulas) da disputa, da mensagem e do envio de resultado.

-- AlterTable
ALTER TABLE "dispute_messages" ADD COLUMN     "authorRole" TEXT;

-- AlterTable
ALTER TABLE "disputes" ADD COLUMN     "escalatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "escalatedById" UUID,
ADD COLUMN     "resolvedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "result_events" ALTER COLUMN "actorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "result_submissions" ADD COLUMN     "rejectReason" TEXT;

-- CreateTable
CREATE TABLE "tournament_podiums" (
    "tournamentId" UUID NOT NULL,
    "places" JSONB NOT NULL,
    "finishedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedById" UUID,

    CONSTRAINT "tournament_podiums_pkey" PRIMARY KEY ("tournamentId")
);

-- AddForeignKey
ALTER TABLE "tournament_podiums" ADD CONSTRAINT "tournament_podiums_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Histórico de resultados: somente inserção (issue #86) ──────────
CREATE OR REPLACE FUNCTION audit.block_result_event_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de resultados é somente inserção: % não é permitido em result_events.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER result_events_block_update_delete
  BEFORE UPDATE OR DELETE ON "result_events"
  FOR EACH ROW EXECUTE FUNCTION audit.block_result_event_changes();

CREATE TRIGGER result_events_block_truncate
  BEFORE TRUNCATE ON "result_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit.block_result_event_changes();

REVOKE UPDATE, DELETE, TRUNCATE ON "result_events" FROM PUBLIC;
