# Banco de dados — guia (issue #66)

Postgres no **Neon** (produção, staging e um banco por preview), acessado pelo **Prisma 7** em `packages/db`. Fonte do schema: `docs/modelo-de-dados.md`.

## Conexões

| Variável | Uso |
|---|---|
| `DATABASE_URL` | **Com pooler.** A aplicação (as funções escalam para muitas instâncias; cada uma abre poucas conexões). |
| `DATABASE_URL_UNPOOLED` | **Sem pooler.** Só para migrations. Criada pela integração do Neon; o plano a chama de `DIRECT_URL` (também aceita). |
| `TEST_DATABASE_URL` | Banco descartável dos testes de integração. Os testes **apagam** tabelas: nunca aponte para um banco com dados. |

## Rodar localmente

Com Docker (Postgres 17, Redis e a ponte REST do Upstash):

```bash
docker compose up -d
```

Em `packages/db/.env` (ignorado pelo git): `DATABASE_URL=postgres://nova:nova@localhost:5432/nova`. Para os testes de integração, `TEST_DATABASE_URL=postgres://nova:nova@localhost:5432/nova_test`. Para o Redis local, `KV_REST_API_URL=http://localhost:8079` e `KV_REST_API_TOKEN=nova-local`.

```bash
pnpm --filter @nova/db exec prisma migrate deploy
```

```bash
pnpm --filter @nova/db db:seed
```

Sem Docker, qualquer PostgreSQL 15 ou mais novo serve (instalado na máquina ou um branch de desenvolvimento do Neon).

> **O `prisma dev` (Prisma Postgres local) não funciona com este schema.** Ele instala um gatilho próprio em toda tabela, e a tabela particionada da auditoria (issue #71) faz essa instalação falhar: o servidor local não sobe mais. Se o servidor-sombra do `migrate dev` ficar em outra porta, defina `SHADOW_DATABASE_URL`.

## Comandos (`pnpm --filter @nova/db …`)

| Comando | O que faz |
|---|---|
| `db:migrate` | Cria uma migration a partir do schema e aplica no banco local (`prisma migrate dev`). |
| `db:deploy` | Aplica as migrations pendentes. Roda sozinho no build da Vercel (fora da Vercel não faz nada). |
| `db:seed` | Seed idempotente. `SEED_PROFILE=dev` (padrão) ou `staging`: catálogo + contas de demonstração. `production`: catálogo + Super Admin de `SEED_SUPER_ADMIN_EMAIL`. Fora de produção, `SEED_DEMO_PASSWORD` (8+ caracteres) dá essa senha às contas de demonstração que ainda não têm senha (usado pelo E2E com a API real, #81). |
| `db:generate` | Gera o client em `src/generated` (também roda no `pnpm install`). |
| `db:reset` | Apaga o banco **local** e refaz tudo. Nunca em staging nem produção. |

## Migrations: compatíveis com a versão anterior

O rollback da Vercel é instantâneo, o do banco não. Toda migration precisa funcionar com o código **anterior e novo** ao mesmo tempo (expandir → migrar → contrair):

- **Adicionar coluna:** sempre nula ou com padrão. Nunca `NOT NULL` sem padrão numa tabela com dados.
- **Renomear coluna ou tabela:** em três PRs: (1) cria a nova e grava nas duas; (2) passa a ler da nova e copia os dados; (3) remove a antiga.
- **Remover coluna:** primeiro um PR que para de usar; só depois o que remove.
- **Mudar tipo:** nova coluna + cópia, como na renomeação.
- **Índice em tabela grande:** `CREATE INDEX CONCURRENTLY` numa migration só com ele (edite o SQL gerado).
- **Nunca** edite uma migration que já foi aplicada em algum ambiente: crie outra.

## Decisões de modelagem

- `nicknameKey` (minúsculas, única) garante apelido único sem diferenciar maiúsculas, sem depender da extensão `citext`.
- Quem executou uma ação (`grantedById`, `reviewedById`, `issuedById`…) fica só como ID, sem chave estrangeira: usuário nunca é apagado (a exclusão LGPD anonimiza) e o histórico não pode depender dele.
- `AuditLog` e `ResultEvent` usam `bigint` sequencial.
- `Standing` é uma tabela recalculada pelo motor a cada resultado (não uma view materializada), com cache no Redis.

## Auditoria (issue #71)

- **Somente inserção:** gatilhos recusam `UPDATE`, `DELETE` e `TRUNCATE` em `audit_logs`, e essas permissões são revogadas de `PUBLIC`. Em produção, a aplicação deve conectar com um papel que tenha só `INSERT` e `SELECT` nessa tabela (o dono do banco ignora as permissões, mas não os gatilhos).
- **Na mesma transação da ação:** `withAudit(db(), { actorId, ip, userAgent, reason }, async (tx) => { ...; await audited(tx, {...}) })`. Ação fora de `AUDIT_ACTIONS` (`@nova/schemas`) é recusada.
- **Mudança de papel:** registrada pelo próprio banco (gatilho em `user_roles`), com o autor vindo do contexto de `withAudit`. Não chame `audited` para `ROLE_GRANTED`/`ROLE_REVOKED`.
- **Partições mensais** no schema `audit` (fora do Prisma): `audit.ensure_partitions(3)` cria do mês atual até 3 meses à frente; o Cron mensal da issue #99 chama a função. Enquanto isso, a partição padrão recebe tudo.
- **Retenção:** `audit.drop_partitions_older_than(meses)` apaga partições inteiras e recusa menos de 12 meses (RNF-15).

## Revisão de índices (R2)

Issue #111 (RNF-01 a RNF-04). Medido no Postgres 17 local com a seed `dev` turbinada por um script descartável: 20 mil usuários, 3 mil campeonatos (todos os estados, 1/6 por equipe), 88 mil inscrições, 32 mil membros de elenco, 48 mil partidas, 88 mil participantes de partida e 300 mil notificações. `EXPLAIN (ANALYZE, BUFFERS)` nas consultas das rotas mais usadas, na forma que o Prisma gera.

| Consulta (rota) | Antes | Depois | O que mudou |
|---|---|---|---|
| Inscrições de uma pessoa em todos os campeonatos (`GET /me/registrations`, `GET /users/:nick/stats`, `GET /me/disputes`) | *Seq Scan* em `registrations` (88 mil linhas descartadas) + *Seq Scan* em `registration_members`: **20,3 ms** | 3 buscas por índice: **≈ 1,3 ms**, proporcional ao que a pessoa tem | Índices `registrations(userId)` e `registration_members(userId)`. O `OR: [{ userId }, { members: { some: { userId } } }]` do Prisma vira `id IN (SELECT …) OR …`, que o Postgres não consegue resolver por índice: as rotas passaram a buscar os IDs antes (`registrationIdsOfUser`, em `modules/registrations/core.ts`). |
| Cron por minuto: reservas de vaga vencidas (`sweep`) | *Seq Scan* em `registrations`: **8,1 ms** (cresce com a tabela, 1.440 vezes por dia) | *Bitmap Index Scan*: **0,12 ms** | Índice `registrations(status, reservedUntil)`. |
| Vitrine com filtro de jogo (`GET /tournaments?game=`) | `tournaments(gameId, status)`: 0,8 ms | igual | Já coberto. |
| Vagas ocupadas de uma página da vitrine (`countsOf`) | *Index Only Scan* em `registrations(tournamentId, status, createdAt)`: 1,0 ms | igual | Já coberto. |
| Chave e partidas de um campeonato | `stages(tournamentId, order)` + `matches(stageId, nodeId)`: 0,2 ms | igual | Já coberto. |
| Participantes das partidas por inscrição | `match_participants(registrationId)`: 1,3 ms | igual | Já coberto. |
| Notificações: lista e contador de não lidas | `notifications(userId, readAt, createdAt)`: 0,1 ms (0,7 ms com 5 mil notificações de uma só pessoa) | igual | Testado `notifications(userId, createdAt)`: sem ganho (a ordem secundária por `id` impede usar a ordem do índice); não entrou, para não pesar a gravação em massa de notificações. |
| Cron: W.O. automático (duelos marcados de campeonatos em andamento) | 40 ms com cache frio, 5 ms quente | igual | Testado `matches(status, scheduledAt)`: o planejador prefere partir de `tournaments(status)`; não entrou. |
| Fila de moderação e auditoria | `reports(status, createdAt)` e `audit_logs(createdAt)` por partição | igual | Já coberto. |

Migration: `20261121190000_r2_indices` (só `CREATE INDEX IF NOT EXISTS`). As tabelas ainda são pequenas no lançamento; se um dia for preciso recriar um índice com a tabela grande, rode `CREATE INDEX CONCURRENTLY` à mão, fora de transação, antes do deploy (a migration com `IF NOT EXISTS` passa a não fazer nada).

**Fica para depois (sem gargalo medido hoje):**
- Busca por texto (`?q=` da vitrine e a busca de usuários do Admin) usa `ILIKE '%…%'`, que não usa índice B-tree. Com mais de ~50 mil campeonatos ou usuários, avaliar `pg_trgm` com índice GIN em `tournaments.name` e `users.nicknameKey`.
- A vitrine lê as colunas de ordenação de **todos** os campeonatos públicos do filtro e ordena na aplicação (ordem por estado). Com o cache na borda (`Cache-Control` público de 30 s, `packages/api/src/http-cache.ts`) o custo é pago uma vez por região a cada 30 s; acima de ~20 mil campeonatos visíveis, trocar por uma coluna de ordem calculada e paginação por chave.

### Neon: *autoscaling* para o pico das finais

- **Mínimo de 0,5 CU** em produção (não deixar o banco "dormir": o *cold start* do Neon soma centenas de ms à primeira consulta) e **máximo de 4 CU** no dia a dia.
- **Dias de final** (o organizador informa a data; o painel Admin mostra os campeonatos ao vivo): subir o **mínimo para 2 CU** e o **máximo para 8 CU** na véspera, voltar no dia seguinte. O teste de carga da #112 confirma esses números (meta: p95 ≤ 300 ms de leitura com 5 mil usuários simultâneos).
- Sempre pela **conexão com pooler** (`DATABASE_URL`, PgBouncer do Neon) nas funções; `DATABASE_URL_UNPOOLED` só nas migrations. Funções e banco na mesma região (`gru1` ↔ `sa-east-1`).
- Acompanhar no painel do Neon: CPU, conexões ativas e *cache hit rate* (abaixo de 99% indica falta de memória: subir o mínimo de CU).
