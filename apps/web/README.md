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
- `NEXT_PUBLIC_API_MOCK`: `all` (padrão) · `none` · lista de módulos (`auth,games`).

## Testes

```bash
pnpm --filter web test         # Vitest (unitários e de componente; arquivos *.test.ts(x) ao lado do código)
pnpm --filter web e2e          # Playwright em 1440 px e 360 px (constrói e sobe o app em :3100)
```

Para rodar E2E contra um servidor já no ar: `PLAYWRIGHT_BASE_URL=http://localhost:3111 pnpm --filter web exec playwright test`.
Para subir uma segunda instância sem conflito de build: `NEXT_DIST_DIR=.next-x pnpm --filter web exec next dev -p 3111`.

Nos testes E2E, importe `test`, `expect`, `loginAs` e `waitForApp` de `./fixtures`. Cada teste começa com o banco simulado limpo (contexto novo do navegador).

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
| Telão (OBS, #124) | `/c/[slug]/telao/tabela` e `/c/[slug]/telao/chave` (`?fase=`, `?fundo=transparente`, `?intervalo=` em s, `?tema=claro`), no grupo `app/(telao)` sem o cabeçalho do site; link "Abrir no telão" na aba Fases do organizador | `features/telao` |
| Ranking de temporada e ligas (#120, ADR-0003) | `/ranking` (seção "Temporada", flag `ranking`), `/u/[nick]` (seção "Rating da temporada"), `/ligas`, `/ligas/[slug]`, `/organizador/ligas`, `/organizador/ligas/nova`, `/organizador/ligas/[id]`, `/admin/temporadas` | `features/seasons`, `features/leagues`; API simulada em `mocks/seasons.ts` e `mocks/handlers/seasons.ts` |

- **Feature flags:** `useFlag('ranking' | 'publicSignup' | 'resultSubmission' | 'pushNotifications')` e `<FlagGate flag>` em `shared/flags`. A flag vale também no handler (`isFlagEnabled` em `mocks/handlers/admin-settings.ts`): esconder na tela não basta.
- **Sessão e papéis na API simulada:** `currentUser()` devolve nulo para quem não está `ACTIVE` (banido, suspenso, mesclado, excluído); `requireAdmin()` exige verificação em duas etapas ativa.
- **Coleções de F2 no banco simulado** (`db().extra`): `stageRuns`, `matchMeta`, `podiums`, `resultEvents`, `auditLogs`, `notifications`, `notificationPreferences`, `reports`, `submissions`, `disputes`, `sanctions`, `roleGrants`, `globalAnnouncements`, `siteSettings`, `featureFlags`, `twoFactor`.
- **Atalhos que só existem no protótipo** e não vão para a API real: `POST /auth/dev-login`, `GET /me/2fa/dev-code`, os tokens `devVerifyToken`/`devResetToken` nas respostas e o link de redefinição mostrado ao Admin.

## Refinamento R1 (responsividade, acessibilidade, PWA)

- **Telas revisadas automaticamente:** `e2e/rotas.ts` lista todas as telas com o usuário que as abre. Tela nova entra ali e passa a ser conferida em 360/480/768/1024/1440 px e paisagem (`r1-responsividade`, com screenshot de cada tamanho no relatório), pelo axe nos dois temas (`r1-acessibilidade`) e, se `principal`, nas áreas de toque de 44 px (`r1-toque-e-movimento`). Roteiros de leitor de tela: `docs/acessibilidade.md`.
- **Carregando:** toda rota tem `loading.tsx` com `RouteSkeleton` (`shared/layout/RouteSkeleton.tsx`). **Vazio:** `EmptyState` com ícone já vem ilustrado (`EmptyIllustration`).
- **Áreas seguras:** `pt-safe`, `px-safe` e `pb-safe` (`viewport-fit=cover`).
- **PWA:** `app/manifest.ts`, ícones em `public/icons` (gerados por `scripts/brand-assets.mts`), service worker em `sw/sw.ts` servido por `app/serwist/[path]/route.ts` (`@serwist/turbopack`). Nunca guarda `/api`. Só é registrado sem API simulada (`NEXT_PUBLIC_API_MOCK=none`) em produção — o MSW usa o mesmo escopo. `NEXT_PUBLIC_PWA=off|on` força. Push: ponto de extensão em `sw/extensions.ts`. Teste do worker de verdade: `e2e/r1-pwa-sw.spec.ts` (instruções no arquivo).
- **Ajuda e suporte:** `/ajuda` (conteúdo em `features/help/faq.ts`), `/contato` (e-mail de `GET /site/settings`), `/manutencao` e o aviso global `SiteBanner` (manutenção aparece 48 h antes, em todas as áreas).

## Pós-lançamento B (issues 121, 123 e 125)

Bot do Discord e chat por partida: `docs/notificacoes.md`. Módulos simulados novos: `discord`, `chat` e `calendar` (paridade de rotas em `packages/api/test/contract-parity-pos-b.unit.test.ts`).

### Leitura do print com OCR (issue 123, experimental)

- **Flag:** `resultOcr`, desligada por padrão; quem liga é o Super Admin em Configurações. A importação pelas APIs oficiais dos jogos ficou de fora, porque depende de parceria.
- **Onde aparece:** "Ler o print" fica no lançamento de queda BR (organização) e no envio de resultado (participante).
- **Como lê:**
  - `tesseract.js` é carregado sob demanda, só no clique (`features/ocr/recognize.ts`), e roda no navegador.
  - Na primeira vez, o navegador baixa o motor e o idioma do CDN jsdelivr. Uma CSP futura precisa liberar `cdn.jsdelivr.net` e `blob:` em `worker-src`.
  - O parser (`features/ocr/parse.ts`) sugere colocação e kills por equipe, ou o placar do duelo, com a confiança de cada valor.
- **Confirmação humana:** a leitura nunca grava sozinha. A tela destaca o que foi lido e exige marcar "Conferi os valores lidos do print" antes de salvar.
- **Imagens de exemplo:** são inventadas e ficam em `features/ocr/fixtures`, geradas por `scripts/ocr-fixtures.mts`. O teste com o Tesseract de verdade só roda com `OCR_REAL=1`, porque baixa o idioma da internet.

### Assistente de formato (issue 125)

- **Onde:** "Sugerir formato" no passo Fases do assistente de criação.
- **O que considera:** o nº de inscritos, o tempo disponível e o jogo/modo.
- **Como sugere:** a função pura `suggestFormats` (`features/organizer/lib/formatAssistant.ts`) monta as fases com os mesmos padrões do StageBuilder e filtra tudo por `validateStages`.
- **Premissas da duração estimada:**
  - partidas da mesma rodada são simultâneas;
  - 10 min por jogo de duelo, vezes a série;
  - 25 min por queda BR;
  - 5 min entre rodadas e 15 min entre fases.

### Calendário .ics (issue 125)

| Rota | Quem usa | O que devolve |
|---|---|---|
| `GET /me/calendar` | pessoa logada | os endereços do calendário pessoal |
| `GET /calendar/u/<userId>.<assinatura>.ics` | aplicativo de calendário, sem cookie | "minhas partidas"; a assinatura é HMAC-SHA256 com `AUTH_JWT_SECRET` |
| `GET /tournaments/:id/calendar` | qualquer pessoa | os endereços do calendário de um campeonato |
| `GET /calendar/t/<slug>.ics` | qualquer pessoa | as partidas do campeonato; rascunho não aparece |

- **Formato:** RFC 5545 (`packages/schemas/src/calendar.ts`), com horários em UTC (`…Z`), linhas dobradas em 75 octetos, `REFRESH-INTERVAL` de 1 h e lembrete 15 min antes.
- **Na tela:** o botão "Adicionar ao calendário" fica em Meus campeonatos e na aba Partidas do campeonato. Ele oferece assinar por `webcal://`, copiar o endereço ou baixar o arquivo.
- **Limitação:** o endereço pessoal não pode ser revogado. Ele só muda se `AUTH_JWT_SECRET` mudar.

### Resultados offline (issue 125)

- **Quando guarda:** o lançamento de queda BR e de duelo continua sem rede. Sem conexão, ou com erro de rede, o envio vai para o IndexedDB (`nova-arena-offline`), com a mesma `Idempotency-Key` do `useSubmitResult`.
- **Fila pendente:** aparece em "Resultados pendentes de envio", na aba Partidas e resultados. O envio é sozinho quando a conexão volta, ou pelo botão.
- **Conflito:** se outra pessoa já lançou o resultado, a API responde `CORRECTION_REASON_REQUIRED`. A tela mostra "Outra pessoa já lançou o resultado desta partida", com "Ver resultado atual" e "Descartar".
- **Limitação:** a prova em imagem não sobe sem rede. O lançamento offline leva só os números.
