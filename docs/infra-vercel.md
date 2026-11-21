# Infraestrutura na Vercel — passo a passo (issue #64, plano B1.1)

Tudo roda em **um único projeto da Vercel** (`apps/web`). Banco, cache, filas, e-mail e erros vêm do **Marketplace**: as variáveis entram sozinhas no projeto e a cobrança vem na fatura da Vercel. O tempo real usa o **Ably**, que tem conta própria (a Vercel não mantém WebSocket).

O que já está no repositório:

| Arquivo | O que faz |
|---|---|
| `apps/web/vercel.json` | Funções na região de São Paulo (`gru1`). Os crons entram com a issue #99. |
| `.env.example` | Catálogo de todas as variáveis, por serviço, com o que cada uma faz. Nunca coloque valores nele. |

> As etapas abaixo **criam contas, contratam serviços ou mexem em produção**: são do dono do projeto. Ninguém do time de desenvolvimento (nem o agente) cria conta ou contrata serviço.

## Checklist do dono

Marque cada item na issue #64 ao concluir.

### 1. Projeto e time (depende da #8)
- [ ] Time na Vercel no **plano Pro** (o Hobby proíbe uso comercial e limita o Cron).
- [ ] Projeto importado do GitHub `pauloj-dev/Nova-Arena`, com **Root Directory = `apps/web`**. Framework: Next.js. Install: `pnpm install --frozen-lockfile` (padrão do monorepo).
- [ ] Membros do time com o papel mínimo necessário (desenvolvedores como *Member*, não *Owner*).
- [ ] **Deployment Protection** ligada para os previews (Vercel Authentication).

### 2. Marketplace (Settings → Integrations, ou aba Storage)
Para cada serviço, escolha a **região mais próxima de São Paulo** que ele oferecer e anote na tabela da seção 6.
- [ ] **Neon Postgres**, com a opção de **criar um branch de banco por preview** ligada. Cria `DATABASE_URL` (com pooler) e `DATABASE_URL_UNPOOLED` (sem pooler, usada nas migrations). O plano chama a segunda de `DIRECT_URL`; vale o nome que a integração criar.
- [ ] **Upstash Redis**. Cria `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
- [ ] **Upstash QStash**. Cria `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY`.
- [ ] **Resend**. Cria `RESEND_API_KEY`. O domínio de envio é configurado na issue #80.
- [ ] **Sentry**. Cria `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` e o token de upload dos *source maps*.

Depois de instalar, confira em Settings → Environment Variables se os nomes batem com o `.env.example`. Se algum vier diferente, avise no PR da issue #65 (a validação das variáveis usa esses nomes).

### 3. Recursos do próprio projeto (aba Storage)
- [ ] **Vercel Blob** (cria `BLOB_READ_WRITE_TOKEN`).
- [ ] **Edge Config** (cria `EDGE_CONFIG`). Para o painel Admin editar as flags (B2.6) também é preciso um token da API da Vercel com escrita no Edge Config (`VERCEL_API_TOKEN`) e o ID do store (`EDGE_CONFIG_ID`).

### 4. Fora do Marketplace
- [ ] Conta no **Ably** e uma chave com permissão de publicar e emitir token → `ABLY_API_KEY`.
- [ ] **OAuth Google** (Google Cloud Console) e **OAuth Discord** (Discord Developer Portal). As URLs de retorno de cada ambiente estão no `.env.example`.

### 5. Segredos gerados pelo time
Gere um valor **diferente por ambiente** e cadastre como *Sensitive*:
- [ ] `AUTH_JWT_SECRET`
- [ ] `CRON_SECRET`
- [ ] `LOBBY_ENCRYPTION_KEY`
- [ ] `TWO_FACTOR_ENCRYPTION_KEY` (2FA, issue #95 — trocar invalida o 2FA de todas as contas)
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (push no PWA, issue #109)

Os comandos para gerar estão no `.env.example`.

### 6. Regiões
Funções em `gru1` (já no `vercel.json`). Para cada serviço, confirme a região mais próxima disponível no momento da criação (plano §2.5 prefere `sa-east-1`) e anote aqui:

| Serviço | Região escolhida |
|---|---|
| Neon | _a preencher_ |
| Upstash Redis | _a preencher_ |
| QStash | _a preencher_ |
| Ably | _a preencher_ |

### 7. Staging e produção
- [ ] Branch `staging` no GitHub.
- [ ] **Custom Environment** "Staging" na Vercel, ligado à branch `staging`.
- [ ] Branch `staging` no Neon, usado só pelo ambiente Staging.
- [ ] Recursos de **produção separados** dos de staging (Redis, QStash, Blob e Edge Config próprios, ou pelo menos chaves diferentes).
- [ ] Variáveis cadastradas para **Development, Preview, Staging e Production**, todas as secretas como *Sensitive*.

### 8. Domínio
- [ ] Domínio definitivo (ADR-0001 Q7: `novaarena.gg`, provisório até a compra) apontado para o projeto, com HTTPS.
- [ ] `NEXT_PUBLIC_SITE_URL` de Production com esse domínio.

### 9. API real no preview e no staging (issues #81 e #102)
Os E2E do CI (`ci.yml`) continuam rodando no próprio runner com a API simulada: **não defina** `PLAYWRIGHT_BASE_URL` no repositório. Desde a #102 **todos** os módulos têm API real: preview, staging e produção não simulam nada.

| Ambiente | `NEXT_PUBLIC_API_MOCK` | Dados |
|---|---|---|
| Local (protótipo) | sem a variável (`all`) | banco simulado no navegador |
| Local com a API real | `none` | Postgres do docker-compose + `pnpm --filter web seed:demo --reset` (ver `apps/web/README.md`, "Modos da API") |
| **Preview** e **Staging** | `none` (é o que `previewMockSetting()` devolve) | branch do Neon + seed de demonstração |
| **Production** | `none` | só o catálogo e o Super Admin (`SEED_PROFILE=production`) |

- [ ] Variável `NEXT_PUBLIC_API_MOCK=none` em **Preview**, **Staging** e **Production** (troca a lista antiga de módulos do B2).
  O tempo real usa o Ably e precisa de `ABLY_API_KEY`; sem a chave, as páginas ao vivo mostram "Reconectando… atualizando a cada 10 s" (CT-10). Para manter só o tempo real simulado num ambiente sem Ably, use `NEXT_PUBLIC_API_MOCK=realtime`.
- [ ] Redis dividido entre ambientes (o mesmo Upstash no preview e no staging): `KV_PREFIX` diferente em cada um (ex.: `preview:` e `staging:`), para um não ler o cache do outro.
- [ ] Seed do banco do preview/staging: `pnpm --filter @nova/db db:seed` com `SEED_PROFILE=staging` cria o catálogo e as contas; para ter também **os cenários do protótipo** (campeonatos em vários estados, Liga Clash Royale em andamento com check-in aberto, Open 8 Ball finalizado com pódio, squads, convites, denúncias, notificações), rode num banco **vazio** `pnpm --filter web seed:demo` com `DATABASE_URL_UNPOOLED`, `SEED_DEMO_PASSWORD` (8+ caracteres) e a mesma `LOBBY_ENCRYPTION_KEY` do ambiente (as salas vão cifradas); `SEED_DEMO_TOTP_SECRET` (Base32) liga o 2FA do Rafael e da Ana. As contas de demonstração entram com essa senha. Nunca em produção (o script recusa `VERCEL_ENV=production`).
- [ ] Vercel → Settings → Deployment Protection → **Protection Bypass for Automation**: gere o segredo.
- [ ] GitHub → Settings → Secrets and variables → Actions:
  - variável `E2E_API_REAL` = `true`;
  - segredo `E2E_DEMO_PASSWORD` (a mesma senha de `SEED_DEMO_PASSWORD`);
  - segredo `VERCEL_AUTOMATION_BYPASS_SECRET` (o segredo do passo anterior).

Com isso, a cada deploy de preview concluído o workflow **E2E no preview (API real)** (`.github/workflows/e2e-preview.yml`) roda `apps/web/e2e/api-real.spec.ts`: vitrine, organizadora cria e publica um campeonato, página pública vem do servidor com título e imagem de compartilhamento, participante se inscreve. O campeonato do teste é cancelado no fim.

Para o CT-02 contra o preview (várias instâncias de função ao mesmo tempo), rode o teste de carga da #112 apontando para o preview; no CI ele já passa contra o Postgres (`registrations.integration.test.ts`).

## Como conferir (critérios de aceite da #64)

1. Abra um PR qualquer: o preview sobe e, em Settings → Environment Variables (Preview), `DATABASE_URL` aponta para um branch do Neon com o nome do PR.
2. `GET <url-do-preview>/api/v1/health` responde com banco, Redis e QStash ok. Essa rota entra com a issue #65.
3. Nenhum segredo no repositório: `git grep -nE "(sk_|whsec_|postgres://|rediss?://)"` não acha nada além do `.env.example` vazio.

## O que o time de desenvolvimento faz em seguida (sem precisar das contas)

- **#65:** `packages/api` (Hono) montado em `app/api/v1/[[...route]]/route.ts`, variáveis validadas com Zod, erros `application/problem+json` e `GET /api/v1/health`.
- **#66:** `packages/db` (Prisma), migrations, seed e Postgres + Redis em Docker para desenvolvimento local.

As duas rodam localmente com Docker. Só precisam das contas na hora de publicar no preview.
