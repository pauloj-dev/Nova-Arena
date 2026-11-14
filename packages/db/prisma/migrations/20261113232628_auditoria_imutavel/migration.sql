-- Auditoria imutável (issue #71, PRD RF-06, RNF-15, §17.2).
--
-- 1. `audit_logs` passa a ser particionada por mês em "createdAt". As partições ficam no schema `audit`,
--    fora do que o Prisma gerencia (ele só olha o `public`), para não aparecerem como diferença nas
--    próximas migrations. Uma partição padrão recebe qualquer data que ainda não tenha partição própria.
-- 2. Gatilhos bloqueiam UPDATE, DELETE e TRUNCATE. Só a retenção (apagar partições inteiras com mais de
--    12 meses, por `audit.drop_partitions_older_than`) remove registros.
-- 3. UPDATE, DELETE e TRUNCATE revogados de PUBLIC. O papel da aplicação deve ter só INSERT e SELECT
--    nesta tabela (docs/banco.md).
--
-- A tabela foi criada na migration anterior e ainda não tem dados em nenhum ambiente; mesmo assim,
-- as linhas existentes são copiadas.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE "audit_logs_new" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL DEFAULT '',
    "tournamentId" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_new_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

CREATE TABLE audit.audit_logs_default PARTITION OF "audit_logs_new" DEFAULT;

INSERT INTO "audit_logs_new" ("id", "actorId", "action", "entityType", "entityId", "tournamentId", "before", "after", "reason", "ip", "userAgent", "createdAt")
SELECT "id", "actorId", "action", "entityType", "entityId", "tournamentId", "before", "after", "reason", "ip", "userAgent", "createdAt" FROM "audit_logs";

DROP TABLE "audit_logs";
ALTER TABLE "audit_logs_new" RENAME TO "audit_logs";
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_new_pkey" TO "audit_logs_pkey";
ALTER SEQUENCE "audit_logs_new_id_seq" RENAME TO "audit_logs_id_seq";
SELECT setval('"audit_logs_id_seq"', COALESCE((SELECT MAX("id") FROM "audit_logs"), 0) + 1, false);

CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_tournamentId_createdAt_idx" ON "audit_logs"("tournamentId", "createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- ── Partições mensais ────────────────────────────────────────────────
-- Cria as partições do mês atual até `months_ahead` meses à frente (idempotente). O Cron mensal (issue #99)
-- chama esta função; enquanto isso, a partição padrão recebe tudo.
CREATE OR REPLACE FUNCTION audit.ensure_partitions(months_ahead integer DEFAULT 3) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  month_start date;
  created integer := 0;
  partition_name text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    month_start := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    partition_name := format('audit_logs_%s', to_char(month_start, 'YYYY_MM'));
    IF to_regclass(format('audit.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start::timestamptz,
        (month_start + interval '1 month')::timestamptz
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Retenção: apaga as partições inteiras mais antigas que `keep_months` meses. Nunca menos de 12 (RNF-15).
CREATE OR REPLACE FUNCTION audit.drop_partitions_older_than(keep_months integer) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  cutoff date;
  dropped integer := 0;
  part record;
BEGIN
  IF keep_months < 12 THEN
    RAISE EXCEPTION 'A auditoria precisa ser mantida por pelo menos 12 meses (pedido: %).', keep_months;
  END IF;
  cutoff := (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => keep_months))::date;
  FOR part IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.inhparent = 'public.audit_logs'::regclass
      AND n.nspname = 'audit'
      AND c.relname ~ '^audit_logs_[0-9]{4}_[0-9]{2}$'
      AND to_date(substring(c.relname from 12), 'YYYY_MM') < cutoff
  LOOP
    EXECUTE format('DROP TABLE audit.%I', part.relname);
    dropped := dropped + 1;
  END LOOP;
  RETURN dropped;
END $$;

SELECT audit.ensure_partitions(3);

-- ── Somente inserção ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit.block_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A auditoria é somente inserção: % não é permitido em audit_logs.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Gatilho de linha no pai vale para todas as partições, inclusive as criadas depois.
CREATE TRIGGER audit_logs_block_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit.block_changes();

CREATE TRIGGER audit_logs_block_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit.block_changes();

REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM PUBLIC;

-- ── Toda mudança de papel gera registro (critério de aceite da #71) ──
-- Garantido no banco: qualquer INSERT ou DELETE em user_roles grava ROLE_GRANTED ou ROLE_REVOKED.
-- Quem fez, o IP e o navegador vêm das configurações da transação definidas por `withAudit()`
-- (packages/db/src/audit.ts): nova.actor_id, nova.ip, nova.user_agent e nova.reason.
CREATE OR REPLACE FUNCTION audit.log_role_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data record;
  label text;
BEGIN
  IF TG_OP = 'INSERT' THEN row_data := NEW; ELSE row_data := OLD; END IF;
  SELECT u."nickname" INTO label FROM public."users" u WHERE u."id" = row_data."userId";
  INSERT INTO public."audit_logs" ("actorId", "action", "entityType", "entityId", "entityLabel", "before", "after", "reason", "ip", "userAgent")
  VALUES (
    NULLIF(current_setting('nova.actor_id', true), '')::uuid,
    CASE WHEN TG_OP = 'INSERT' THEN 'ROLE_GRANTED' ELSE 'ROLE_REVOKED' END,
    'User',
    row_data."userId"::text,
    COALESCE(label, ''),
    CASE WHEN TG_OP = 'DELETE' THEN jsonb_build_object('role', row_data."role"::text) END,
    CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_object('role', row_data."role"::text) END,
    NULLIF(current_setting('nova.reason', true), ''),
    NULLIF(current_setting('nova.ip', true), ''),
    NULLIF(current_setting('nova.user_agent', true), '')
  );
  RETURN NULL;
END $$;

CREATE TRIGGER user_roles_audit
  AFTER INSERT OR DELETE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION audit.log_role_change();
