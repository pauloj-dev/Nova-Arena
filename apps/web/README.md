# apps/web — convenções

App Next.js (App Router) da Nova Arena. Leia junto com o `CLAUDE.md` da raiz.

## Pastas

```
app/
  (site)/        público + participante (casca SiteShell, acento verde). Rotas: /, /campeonatos, /c/[slug], /jogos, /ranking, /u/[nick], /minha-conta/*
  (auth)/        /entrar, /cadastro, /verificar-email, /recuperar-senha, /redefinir-senha, /convite/[token]
  organizador/   área do organizador (AreaShell teal, RequireRole)
  admin/         área do admin (AreaShell verde-escuro, RequireRole + 2FA)
features/<area>/ componentes e lógica de cada funcionalidade (auth, tournaments, teams, registrations, organizer, admin, scoring…)
shared/
  api/client.ts  cliente único (`api.get/post/put/patch/delete`, `ApiError`, `errorMessage`)
  api/keys.ts    todas as query keys do TanStack Query
  api/hooks/     um arquivo por módulo, com `useQuery`/`useMutation`
  session/       `useSession`, `useLogin`, `useLogout`, `useDevLogin`
  layout/        SiteShell, AreaShell, PageContainer, PageHeader, RequireRole, Forbidden
  lib/           datetime (UTC → fuso do usuário), sanitize (rich-text e embeds)
  theme/         tema claro/escuro
mocks/           API simulada (MSW): db.ts, seed.ts, views.ts, http.ts, handlers/<módulo>.ts
e2e/             Playwright (fixtures.ts tem `test`, `expect`, `loginAs`, `waitForApp`)
```

## Regras

1. **Páginas são Client Components finos.** `app/**/page.tsx` só importa o componente da feature e repassa parâmetros. No Next.js 16, `params` e `searchParams` são `Promise`: em Client Component use `use(params)` ou `useParams()`; `useSearchParams()` precisa estar dentro de `<Suspense>`.
2. **Dados só por `shared/api`.** Nada de `fetch` em componente. Cada chamada valida a resposta com o schema de `@nova/schemas` (`api.get(path, { schema })`). Query keys vêm de `keys`. Depois de uma mutação, invalide as chaves afetadas.
3. **Contratos em `@nova/schemas`.** Se faltar um schema, crie no módulo certo do pacote e exporte. Formulários usam React Hook Form + `zodResolver` com o mesmo schema da API.
4. **API simulada.** Um arquivo por módulo em `mocks/handlers/`. Use os helpers de `mocks/http.ts` (`handle`, `body`, `json`, `requireUser`, `requireRole`, `requireTournamentAccess`, `HttpProblem`…) e converta os registros com `mocks/views.ts`. O handler aplica as **mesmas regras e permissões** que a API real terá (PRD §6 e `docs/regras-de-negocio.md`) e chama `save()` depois de mutar `db()`. Rotas específicas antes das genéricas.
5. **UI só com `@nova/ui` e classes ligadas aos tokens** (`bg-surface`, `text-muted`, `bg-accent`, `border-border`, `text-primary-text`, `bg-primary-soft`…). Nenhuma cor hex, `rgb()` ou classe de paleta do Tailwind (`bg-green-500` não existe aqui). `pnpm check:colors` (na raiz) confere.
6. **Mobile primeiro.** Toda tela funciona em 360 px e 1440 px, sem rolagem horizontal. Breakpoints: base (360) · `xs:` 480 · `md:` 768 · `lg:` 1024 · `xl:` 1440.
7. **Três estados em toda consulta:** carregando (`Skeleton` no formato do conteúdo, nunca spinner de tela cheia), vazio (`EmptyState` com ação sugerida) e erro (`ErrorState` com "Tentar novamente").
8. **Acessibilidade AA.** Um `<h1>` por página, rótulo em todo campo, botões com nome acessível, status com ícone + texto (`StatusPill`), foco visível, tudo operável por teclado.
9. **Datas:** ISO em UTC nos dados; na tela, sempre `formatDateTime`/`formatDate`/`formatTime` de `shared/lib/datetime` (mostram o fuso). Campos de data usam `localInputToIso`/`isoToLocalInput`.
10. **Textos em pt-BR**, na voz do produto: diretos, falando com o jogador ou o organizador. Erros dizem o que aconteceu e o que fazer.
11. **Feedback de mutação:** `useToast()` para sucesso e erro (`errorMessage(e)`); erros de campo (`ApiError.fieldErrors`) vão para o formulário.

## Componentes do design system (`@nova/ui`)

`Button` (variant: primary/secondary/ghost/danger/gold · size · loading · asChild · iconLeft/iconRight · fullWidth), `Input`, `Textarea`, `Select` (nativo, `options`), `Checkbox`, `Switch`, `Badge`, `StatusPill` (`status`), `Card`, `Avatar`, `Tabs` (`items`), `Skeleton`, `EmptyState`, `ErrorState`, `Progress`, `Modal`, `ConfirmDestructive`, `Drawer`, `useToast`, `Stepper`, `DataTable`, `cn`. Ícones: `lucide-react`. Primitivos extras: `radix-ui`. Veja o Storybook (`pnpm storybook`) ou `packages/ui/src/components`.

## Protótipo

- Seletor **"Entrar como"** (canto inferior esquerdo): Bianca (participante), Lucas (capitão), Camila (organizadora verificada), Diego (organizador), Ana (admin), Rafael (super admin). Senha de todas as contas: `arena1234`.
- Os dados ficam no `localStorage` do navegador. "Reiniciar dados" volta ao seed (`mocks/seed.ts`).
- `NEXT_PUBLIC_API_MOCK`: `all` (padrão) · `none` · lista de módulos (`auth,games`). Ver "Modos da API" abaixo.

## Modos da API

| Modo | `NEXT_PUBLIC_API_MOCK` | Onde | O que precisa |
|---|---|---|---|
| **Protótipo** (tudo simulado, dados no `localStorage`) | sem a variável, ou `all` | `pnpm dev` local, E2E do CI | nada |
| **API real** | `none` | preview, staging e produção (desde a #102: `previewMockSetting()` em `mocks/handlers/index.ts` devolve `none`); local para testar contra o Postgres | Postgres com as migrations e a seed, e as variáveis do servidor |
| Misto (só alguns módulos simulados) | lista, ex.: `realtime` | depuração | — |

Com `none`, o MSW e o banco simulado nem são carregados no navegador (`MockGate` só importa os handlers sob demanda), o seletor "Entrar como" some e os atalhos do protótipo não existem.

**API real no computador** (Postgres e Redis do `docker compose up -d`):

```bash
docker compose exec -T postgres psql -U nova -d nova -c "create database nova_dev"
DATABASE_URL=postgres://nova:nova@localhost:5432/nova_dev DATABASE_URL_UNPOOLED=postgres://nova:nova@localhost:5432/nova_dev \
  pnpm --filter @nova/db exec prisma migrate deploy
# apps/web/.env.local (não vai para o git):
#   NEXT_PUBLIC_API_MOCK=none
#   NEXT_PUBLIC_SITE_URL=http://localhost:3000
#   DATABASE_URL=… e DATABASE_URL_UNPOOLED=… (o banco acima)
#   AUTH_JWT_SECRET, LOBBY_ENCRYPTION_KEY, TWO_FACTOR_ENCRYPTION_KEY, CRON_SECRET (gere como no /.env.example)
#   KV_REST_API_URL=http://localhost:8079  KV_REST_API_TOKEN=nova-local  KV_PREFIX=dev:   (Redis do docker-compose)
#   SEED_DEMO_PASSWORD=arena1234   SEED_DEMO_TOTP_SECRET=<Base32, opcional: 2FA do Rafael e da Ana>
pnpm --filter web seed:demo --reset   # os mesmos cenários do protótipo, no Postgres
pnpm dev
```

Sem `ABLY_API_KEY`, as páginas ao vivo mostram "Reconectando… atualizando a cada 10 s" (CT-10); sem `BLOB_READ_WRITE_TOKEN`, o envio de imagens responde 503; sem `RESEND_API_KEY`, os e-mails só aparecem no log do servidor; sem QStash, os jobs agendados ficam com o Cron (`GET /api/v1/cron/sweep` com o `CRON_SECRET`).

**Seed de demonstração** (`scripts/seed-demo.ts` → `seedDemo()` de `@nova/api/demo`): grava o objeto de `mocks/seed.ts` com UUIDs determinísticos (`demoId('u_bianca')`, `demoId('tn_liga_cr')`…), as chaves projetadas pelas funções da API (Liga Semanal Clash Royale em andamento com o check-in da Bianca aberto, Open 8 Ball Pool finalizado com pódio), squads e convites, convites de papel (válidos, expirado e revogado), pedido de organizador, denúncias e notificações de demonstração. Idempotente; `--reset` apaga tudo antes (só local: desliga os gatilhos de "somente inserção"). Nunca em produção.

## Testes

```bash
pnpm --filter web test         # Vitest (unitários e de componente; arquivos *.test.ts(x) ao lado do código)
pnpm --filter web e2e          # Playwright em 1440 px e 360 px (constrói e sobe o app em :3100)
```

Para rodar E2E contra um servidor já no ar: `PLAYWRIGHT_BASE_URL=http://localhost:3111 pnpm --filter web exec playwright test`.
Para subir uma segunda instância sem conflito de build: `NEXT_DIST_DIR=.next-x pnpm --filter web exec next dev -p 3111`.

Nos testes E2E, importe `test`, `expect`, `loginAs` e `waitForApp` de `./fixtures`. Cada teste começa com o banco simulado limpo (contexto novo do navegador).

**E2E com a API real** (`E2E_MODE=real`, issue #102): a mesma suíte, contra um servidor local com `NEXT_PUBLIC_API_MOCK=none` e o `.env.local` acima.

```bash
cd apps/web
NEXT_DIST_DIR=.next-real pnpm exec next dev -p 3141      # ou next build && next start
E2E_MODE=real PLAYWRIGHT_BASE_URL=http://localhost:3141 PW_OUTPUT_DIR=test-results-real pnpm exec playwright test
```

- O `globalSetup` (`e2e/real/global-setup.ts`) zera o banco do servidor, roda a seed de demonstração e guarda um retrato no schema `e2e_snapshot`; **cada teste restaura o retrato** (com as datas andando o tempo que passou) e apaga o cache do servidor no Redis (`KV_PREFIX` obrigatório para isso). Um teste por vez (`workers: 1`).
- `mid('tn_liga_cr')` dá o ID do registro no modo em uso (o próprio ID no protótipo; o UUID da seed com a API real).
- Atalhos do protótipo têm caminho equivalente em `e2e/real/`: `loginAs` abre a sessão direto no banco (em vez de `/auth/dev-login`); `apiAs(...)` chama a API como outra pessoa pelo Node; `emailLink(email, 'VERIFY' | 'RESET')` é o link que o e-mail levaria; `totp(segredo)` é o código do aplicativo autenticador. Cada teste usa um IP próprio (`x-forwarded-for`) para o limite de 5 logins por minuto.
- Ficam de fora com o motivo no próprio teste (`test.skip(isRealApi, …)`): o que depende de credencial que o ambiente local não tem (OAuth do Google/Discord, Vercel Blob, Ably) e o que só existe no protótipo.
- `api-real.spec.ts` também roda contra o preview (`E2E_API_REAL=1`, sem acesso ao banco).

## Competição, tempo real e utilidades compartilhadas (F2)

- **Contratos:** `packages/schemas/src/competition.ts` (chave, partidas, classificação, resultados, envios, disputas, uploads, perfil competitivo), `governance.ts` (denúncias, sanções, usuários do Admin, convites, auditoria, estatísticas, configurações, flags, saúde, comunicados, 2FA) e `notification.ts` (notificações e eventos de tempo real).
- **Hooks de competição:** `shared/api/hooks/competition.ts` — `useBracket`, `useStandings`, `useTournamentMatches`, `useMatch`, `useMatchLobby`, `useCheckIn`, `useGenerateBracket`, `useSwapSeeding`, `useConfirmBracket`, `useAdvancePreview`, `useAdvanceStage`, `useScheduleMatch`, `useScheduleRound`, `useStartMatch`, `useSubmitResult`, `useWalkover`, `useImportResults`, `useWithdraw`, `usePodium`, `useFinishTournament` etc.
- **API simulada de competição:** `mocks/handlers/competition.ts` sobre `mocks/competition.ts` (usa o motor). O ID da partida é `<stageId>~<nó>`. A chave gerada fica como prévia (`state: 'PREVIEW'`) até ser confirmada; trava depois da 1ª partida concluída.
- **Tempo real:** `shared/realtime` — `useTournamentChannel(tournamentId)` invalida as consultas quando chega evento; `<LiveIndicator />` mostra "AO VIVO" ou "Reconectando…"; quando a conexão cai, as consultas ao vivo passam a atualizar a cada 10 s. No protótipo, `window.__novaRealtime.setOnline(false)` simula a queda. Handlers publicam com `publish(canal, evento)` de `mocks/bus.ts`, sempre **depois** de gravar e **sem dados sensíveis**.
- **Auditoria:** toda ação sensível em handler chama `audit(ator, {...})` de `mocks/audit.ts` (somente inserção). O catálogo de ações é `AUDIT_ACTIONS`.
- **Notificações:** `notify(userIds, tipo, título, corpo, link)` de `mocks/notify.ts` grava para cada destinatário respeitando as preferências e avisa o canal `user:{id}`.
- **Uploads:** `uploadImage(file, finalidade)` de `shared/api/upload.ts` valida (imagem, 5 MB), comprime no navegador, pede o token e envia direto ao armazenamento. Devolve a URL.
- **Testes de regra sem navegador:** `mocks/testing.ts` (`setupMockApi`, `as`, `call`, `mutate`) sobe a API simulada inteira no Vitest. Exemplo: `mocks/competition.test.ts`.
- **E2E em paralelo:** além de `PLAYWRIGHT_BASE_URL`, defina `PW_OUTPUT_DIR=test-results-<seu-nome>` para não apagar a saída de outra execução.
- **Dados de demonstração de competição:** "Liga Semanal Clash Royale 1v1" (`liga-semanal-clash-royale`) está em andamento, com as oitavas jogadas e a partida da Bianca nas quartas com check-in aberto e sala definida; "Open 8 Ball Pool" (`open-8-ball-pool`) está finalizado, com tabela do suíço e pódio.

## Telas de F2 e onde ficam

| Área | Rotas | Código |
|---|---|---|
| Participante | `/c/[slug]?aba=chave\|partidas\|resultados`, `/c/[slug]/arte`, `/notificacoes`, `/minha-conta/notificacoes`, `/minha-conta/denuncias`, `/minha-conta/seguranca` (2FA), `/disputas/[id]`, `/termos`, `/privacidade` | `features/brackets`, `features/matches`, `features/notifications`, `features/reports`, `features/disputes`, `features/profile/{competitive,security}`, `features/artwork` |
| Organizador | `/organizador/campeonatos/[id]?aba=fases\|partidas\|validacao\|equipe\|comunicados\|auditoria` | `features/organizer/{manage,operation,onboarding}` |
| Admin | `/admin`, `/admin/usuarios`, `/admin/administradores`, `/admin/organizadores`, `/admin/campeonatos`, `/admin/comunicados`, `/admin/auditoria`, `/admin/moderacao`, `/admin/configuracoes`, `/admin/saude` | `features/admin/*` |

- **Feature flags:** `useFlag('ranking' | 'publicSignup' | 'resultSubmission' | 'pushNotifications')` e `<FlagGate flag>` em `shared/flags`. A flag vale também no handler (`isFlagEnabled` em `mocks/handlers/admin-settings.ts`): esconder na tela não basta.
- **Sessão e papéis na API simulada:** `currentUser()` devolve nulo para quem não está `ACTIVE` (banido, suspenso, mesclado, excluído); `requireAdmin()` exige verificação em duas etapas ativa.
- **Coleções de F2 no banco simulado** (`db().extra`): `stageRuns`, `matchMeta`, `podiums`, `resultEvents`, `auditLogs`, `notifications`, `notificationPreferences`, `reports`, `submissions`, `disputes`, `sanctions`, `roleGrants`, `globalAnnouncements`, `siteSettings`, `featureFlags`, `twoFactor`.
- **Atalhos que só existem no protótipo** e não vão para a API real: `POST /auth/dev-login`, `GET /me/2fa/dev-code`, os tokens `devVerifyToken`/`devResetToken` nas respostas e o link de redefinição mostrado ao Admin. A API real não tem nenhum deles (o teste `packages/api/test/contract-parity.unit.test.ts` garante); com ela, os links vão só por e-mail.
