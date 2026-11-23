# @nova/api — API real (Hono)

Monólito modular rodando como Vercel Function (ADR-001), montado no Next.js em `apps/web/app/api/v1/[[...route]]/route.ts`. Base: `/api/v1`.

## Regra de ouro: porte, não reinvente

A API simulada (`apps/web/mocks/handlers/*.ts`) é a especificação executável. Cada módulo daqui reproduz o módulo de lá: mesmas rotas, mesmas permissões (matriz RBAC do PRD §6), mesmos códigos de erro (`code`) e mesmas mensagens em pt-BR. Os contratos vêm de `@nova/schemas`.

## Peças

| Arquivo | O que faz |
|---|---|
| `src/app.ts` | `createApp({ env, deps, logSink })`: ID de requisição, log de cada requisição, registro dos módulos, 404 e erros em `application/problem+json`. |
| `src/env.ts` | Variáveis validadas com Zod (catálogo em `/.env.example`). Formato conferido sempre; em produção os serviços do núcleo são obrigatórios. Validadas na primeira requisição, não no build. |
| `src/context.ts` | `body(c, Schema)` lê e valida o corpo (400 `VALIDATION` com `errors` por campo). `respond(c, Schema, data)` valida a resposta pelo contrato: fora do contrato vira 500 `CONTRACT_VIOLATION`. |
| `src/errors.ts` | `HttpProblem` e atalhos (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`), no mesmo formato da API simulada. |
| `src/logger.ts` | Uma linha JSON por evento, sempre com `requestId`. Nunca registre senha, token, cookie, código de sala nem corpo de requisição. |
| `src/modules/<módulo>/index.ts` | Um `Hono` por módulo, registrado em `modules` no `app.ts`. |
| `src/vercel.ts` | `createRouteHandler()` para a rota do Next.js. |

## Painel Admin e moderação (B2.6/B2.8)

| Arquivo | O que faz |
|---|---|
| `src/auth/admin.ts` | `requireAdminTwoFactor(c, { superAdmin? })` (mesmo contrato do helper da frente de 2FA) e o middleware `adminArea`, aplicado pelo app em **toda** rota `/admin/*`, de qualquer módulo: Admin ou Super Admin com 2FA ativo e feito na sessão; senão 403 `TWO_FACTOR_REQUIRED`. |
| `src/modules/admin/*` | Usuários, sanções (efeito imediato: versão da sessão + `session.revoked`), mescla (RN-13), convites (só o hash do token no banco), papéis (RN-11), organizadores (RN-09, RN-10), campeonatos, comunicados globais (notificação em lotes pela fila), auditoria (CSV em streaming), KPIs e métricas de produto. `GET /cron/sanctions` expira suspensões a cada minuto. |
| `src/modules/reports` | Denúncias, fila de moderação e disputas escaladas. |
| `src/modules/site` | Configurações e flags (banco como fonte de verdade; leitura pelo Edge Config quando `EDGE_CONFIG` existe; gravação pela API da Vercel com `EDGE_CONFIG_ID` e `VERCEL_API_TOKEN`), `isFlagEnabled(c, key)` para os outros módulos, saúde do sistema e eventos de produto sem cookies (`/events`, `/me/nps`). |

## R2: antifraude, LGPD e observabilidade

| Arquivo | O que faz |
|---|---|
| `src/fraud.ts` | Detecção antifraude (#114): várias contas por IP (5 em 24 h) e por aparelho (cookie `na_dev`, 3 em 30 dias) a cada sessão nova; ID de jogo repetido ao salvar; ações administrativas em massa lidas da auditoria (10 banimentos/min…), com aviso ao Super Admin. Limites em `FRAUD_THRESHOLDS` (`@nova/schemas`). Nunca derruba a requisição. |
| `src/modules/fraud` | `GET/PATCH /admin/fraud-alerts` (alerta sobre Admin só para o Super Admin; quem disparou não analisa) e o middleware `watchAdminActions` em `/admin/*`. |
| `src/privacy.ts`, `src/modules/privacy` | LGPD (#115): `POST /me/export` (JSON na hora; conta grande vai para o job `/jobs/privacy/export` com o arquivo no Blob privado), `GET /me/exports`, `GET /me/exports/:id/download`, `GET /me/deletion`, `DELETE /me` (anonimização conforme `docs/modelo-de-dados.md`). |
| `src/observability.ts` | Erros do Sentry na última hora para a Saúde do Sistema (#116), com `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`. |
| `deps.reportError` | Todo 500 da API e toda falha de job vão para o monitoramento de erros (a rota do Next liga o Sentry). |
| `jobs/runner.ts` | Batimento do Cron (`cron ok` no log + `cron:last:<job>` no cache) para o alerta "Cron sem rodar". |

Testes: `fraud.integration`, `privacy.integration`, `idor.integration` (acesso a dados de outra pessoa em todos os
recursos com dono) e `observability.unit`.

Efeitos depois do commit (notificação, tempo real) passam por `AfterCommit` (`modules/admin/shared.ts`), que usa `notify()` e `publish()` de `src/notify.ts`.

## Ranking de temporada e ligas (#120, ADR-0003)

| Arquivo | O que faz |
|---|---|
| `src/modules/seasons/ratings.ts` | Replay do rating da temporada pelo motor a partir dos retratos das fases, em cache pela versão do histórico (`result_events`); `entrantRatings` para o seeding `RANKED`. |
| `src/modules/seasons/index.ts` | `GET /seasons`, `GET /games/:slug/season-ranking`, `GET /users/:nickname/rating`, `GET /teams/:id/rating` (flag `ranking`) e `POST\|PATCH\|DELETE /admin/seasons`. |
| `src/modules/seasons/leagues.ts` | `GET /leagues`, `GET /leagues/:slug` e a gestão em `/organizer/leagues` (dona ou Admin; campeonato só de quem organiza, do mesmo jogo, uma liga por campeonato). |

## Pós-lançamento B (issues 121 e 125)

| Arquivo | O que faz |
|---|---|
| `src/discord/index.ts` | Configuração do bot (`discordConfigured`), assinatura Ed25519 das interações, comandos (fonte única do `ops/discord/register-commands.mts`), `announceDiscord` e `scheduleDiscordReminder` (fila do QStash; nunca lançam). |
| `src/modules/discord/*` | `POST /discord/interactions` (webhook do Discord, fora da checagem de `Origin`), aba Discord da organização e os jobs `/jobs/discord/announce` e `/jobs/discord/reminder`. `announce.ts` tem os avisos chamados pela competição, junto de `notify`/`publish`. |
| `src/modules/chat` | Chat por partida (`/matches/:id/chat`), com limite de envio, ocultar e denúncia (`CHAT_MESSAGE`). |
| `src/modules/calendar` | Calendário .ics pessoal (URL assinada) e do campeonato. |

Detalhes em `docs/notificacoes.md` e `docs/jobs.md`.

## Novo módulo

1. `src/modules/<nome>/index.ts` exporta `new Hono<AppEnv>()` com as rotas.
2. Registre em `modules` no `src/app.ts`.
3. Entrada com `body(c, Schema)`, saída com `respond(c, Schema, data)`; erros com `HttpProblem`.
4. Teste com `createApp({ env: envFrom({...}), deps })` e `app.request('/api/v1/...')`: cada rota × visitante, participante, organizador e admin (401/403/200), e a resposta validada pelo schema.
5. Tire o módulo de `NEXT_PUBLIC_API_MOCK` quando as telas funcionarem contra ele.

## Seed de demonstração, matriz RBAC e cenários de referência (issue #102)

- `src/demo/seed.ts` (`@nova/api/demo`): `seedDemo(db, env, data)` grava no Postgres o objeto de `apps/web/mocks/seed.ts` com UUIDs determinísticos (`demoId('u_bianca')`, de `@nova/api/demo-ids`), chaves projetadas por `projectRun`/`persistStandings` e salas cifradas. Rode com `pnpm --filter web seed:demo [--reset]` (ver `apps/web/README.md`, "Modos da API").
- `test/rbac-full.integration.test.ts`: matriz RBAC completa do PRD §6 — **toda rota registrada** × visitante, participante, moderador, organizador dono, outro organizador, Admin sem 2FA, Admin com 2FA e Super Admin. Rota nova sem linha na tabela quebra o teste.
- Cenários do plano §9 contra o Postgres: CT-01, CT-05 e CT-08 (`results`), CT-02 (`registrations`), CT-03 e CT-09 (`admin-users`), CT-04 e CT-06 completo com a planilha do motor (`ct`), CT-06 reduzido e CT-08 na chave (`advance`), CT-07 (`check-in`). CT-10 é de tela (`apps/web/e2e/competicao-participante.spec.ts`).
- `test/contract-parity.unit.test.ts`: toda rota de todo módulo do mock existe aqui, e nenhum atalho do protótipo (`/auth/dev-login`, `/me/2fa/dev-code`, `devVerifyToken`, `devResetToken`) existe.
- `KV_PREFIX`: prefixo das chaves no Redis (cache, idempotência, limites) quando o mesmo Upstash serve mais de um ambiente. Se o Redis falhar (ou for o Redis local, que não roda os scripts do `@upstash/ratelimit`), o limite de tentativas vale por instância em memória.

## Comandos

```bash
pnpm --filter @nova/api test
pnpm --filter @nova/api typecheck
```

`GET /api/v1/health` responde o estado do banco, do Redis e do QStash (200 `ok` ou `degraded`; 503 quando algo configurado está fora). A verificação do banco entra com `packages/db` (issue #66).
