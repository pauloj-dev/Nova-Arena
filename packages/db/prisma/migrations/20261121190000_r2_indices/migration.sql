-- Revisão de índices do R2 (issue #111). Só aditiva: três índices novos, nenhum dado alterado.
-- Planos antes/depois em docs/banco.md, seção "Revisão de índices (R2)".
--
-- As tabelas ainda são pequenas no lançamento: `CREATE INDEX` comum leva milissegundos. Se um dia for preciso
-- recriar algum com a tabela grande, use `CREATE INDEX CONCURRENTLY` fora de transação (docs/banco.md).

-- "Minhas inscrições", estatísticas do perfil e "minhas disputas": inscrições solo de uma pessoa em todos os campeonatos.
CREATE INDEX IF NOT EXISTS "registrations_userId_idx" ON "registrations"("userId");

-- Cron por minuto: reservas de vaga vencidas (status = PENDING_MEMBERS e reservedUntil <= agora).
CREATE INDEX IF NOT EXISTS "registrations_status_reservedUntil_idx" ON "registrations"("status", "reservedUntil");

-- Elencos de squad de que a pessoa faz parte, em qualquer campeonato.
CREATE INDEX IF NOT EXISTS "registration_members_userId_idx" ON "registration_members"("userId");
