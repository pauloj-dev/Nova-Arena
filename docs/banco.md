# Banco de dados — guia (issue #66)

Postgres no **Neon** (produção, staging e um banco por preview), acessado pelo **Prisma 7** em `packages/db`. Fonte do schema: `docs/modelo-de-dados.md`.

## Conexões

| Variável | Uso |
|---|---|
| `DATABASE_URL` | **Com pooler.** A aplicação (as funções escalam para muitas instâncias; cada uma abre poucas conexões). |
| `DATABASE_URL_UNPOOLED` | **Sem pooler.** Só para migrations. Criada pela integração do Neon; o plano a chama de `DIRECT_URL` (também aceita). |
| `TEST_DATABASE_URL` | Banco descartável dos testes de integração. Os testes **apagam** tabelas: nunca aponte para um banco com dados. |

## Rodar localmente

**Sem Docker** (Prisma Postgres local):

```bash
pnpm --filter @nova/db db:local -- --name nova-arena --detach
```

O comando mostra a URL `postgres://…`. Coloque em `packages/db/.env` (ignorado pelo git) como `DATABASE_URL` e depois:

```bash
pnpm --filter @nova/db db:migrate
```

```bash
pnpm --filter @nova/db db:seed
```

O servidor local tem um banco só: para os testes de integração, use um Postgres de verdade (Docker ou o do CI).

**Com Docker** (Postgres, Redis e a ponte REST do Upstash):

```bash
docker compose up -d
```

`DATABASE_URL=postgres://nova:nova@localhost:5432/nova`, `TEST_DATABASE_URL=postgres://nova:nova@localhost:5432/nova_test`, `KV_REST_API_URL=http://localhost:8079` e `KV_REST_API_TOKEN=nova-local`.

## Comandos (`pnpm --filter @nova/db …`)

| Comando | O que faz |
|---|---|
| `db:migrate` | Cria uma migration a partir do schema e aplica no banco local (`prisma migrate dev`). |
| `db:deploy` | Aplica as migrations pendentes. Roda sozinho no build da Vercel (fora da Vercel não faz nada). |
| `db:seed` | Seed idempotente. `SEED_PROFILE=dev` (padrão) ou `staging`: catálogo + contas de demonstração. `production`: catálogo + Super Admin de `SEED_SUPER_ADMIN_EMAIL`. |
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
- `AuditLog` e `ResultEvent` usam `bigint` sequencial. O bloqueio de `UPDATE`/`DELETE` no `AuditLog` (gatilho e permissões) entra com a issue #71.
- `Standing` é uma tabela recalculada pelo motor a cada resultado (não uma view materializada), com cache no Redis.
