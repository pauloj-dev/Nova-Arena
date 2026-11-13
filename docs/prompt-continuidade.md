# Prompt de continuidade — fases B1, B2, R1 e R2

## Como usar

1. Atualize a `main` (`git checkout main && git pull`) e rode `pnpm install`.
2. Abra o Claude Code na raiz do repositório.
3. Cole o prompt abaixo (tudo o que está dentro do bloco) e envie.
4. O agente trabalha uma issue por vez, abre um PR para cada uma e para quando precisa de você (contas, pagamentos, decisões de produto). Revise e faça o merge de cada PR.

Antes de começar o B1 você vai precisar de: acesso de dono à conta da Vercel (plano Pro), a uma conta do Ably e às credenciais OAuth do Google e do Discord. O agente não cria contas nem contrata serviços.

---

````text
Você vai continuar o desenvolvimento da Nova Arena, plataforma de campeonatos de eSports mobile, a partir da fase B1 (back-end). As fases M0, F1 e F2 já estão na `main`: o produto inteiro existe como protótipo navegável sobre uma API simulada (MSW). Seu trabalho agora é construir a API real na Vercel, trocar o mock por ela tela a tela, e depois fazer o refinamento e o lançamento.

## 1. Leia antes de qualquer código

Nesta ordem, inteiros:
1. `CLAUDE.md` (regras do projeto e o mapa "tipo de tarefa → skill e agent" em `.claude/`).
2. `docs/plano-de-implementacao.md`: §2 (arquitetura na Vercel), §4 (Definição de Pronto, fluxo, testes), §6 (B1 e B2), §7 (R1 e R2), §9 (cenários CT-01 a CT-10) e §10 (checklist de produção).
3. `docs/prd.md` (o produto), `docs/regras-de-negocio.md` (RN-06 a RN-15), `docs/modelo-de-dados.md` (entidades, enums, exclusão LGPD) e `docs/adr/0001-decisoes-iniciais.md`.
4. `apps/web/README.md` (convenções do app, rotas de F2, coleções do banco simulado, atalhos do protótipo) e `packages/schemas/README.md` (contratos × endpoints).
5. `packages/engine/README.md` (motor de chaveamento e pontuação; já pronto e testado).

O Next.js deste projeto é a versão 16: consulte `apps/web/node_modules/next/dist/docs/` antes de usar qualquer API da qual não tenha certeza (`proxy.ts` no lugar de `middleware.ts`; `params` e `searchParams` são `Promise`).

## 2. A estratégia: a API simulada é a especificação executável

Cada arquivo em `apps/web/mocks/handlers/*.ts` já implementa as regras de negócio, as permissões da matriz RBAC (PRD §6), a auditoria e os códigos de erro de um módulo da API. Os contratos estão em `packages/schemas`. Por isso:

- **Porte, não reinvente.** Para cada módulo, leia o handler simulado e reproduza o mesmo comportamento em `packages/api` (Hono) com `packages/db` (Prisma + Neon). Mesmas rotas, mesmos códigos de erro (`code` no `application/problem+json`), mesmas mensagens em pt-BR. Onde o mock simplifica (sessão em `localStorage`, "jobs" executados na leitura, publicação de evento em memória), implemente o mecanismo real do plano §2 (cookies `httpOnly` + JWT, QStash + Cron, Ably, Vercel Blob, Edge Config, Resend).
- **Reaproveite os testes de regra.** Os testes que usam `apps/web/mocks/testing.ts` (`setupMockApi`, `as`, `call`, `mutate`) exercitam as regras pela API, sem navegador: `apps/web/mocks/competition.test.ts`, `mocks/integration.test.ts`, `mocks/handlers/admin.test.ts` e os `features/*/api.test.ts`. Em B1.1, crie um harness equivalente que chame o app Hono real (`app.request`) com Postgres em contêiner, e rode esses mesmos cenários contra a API real. Um cenário que passa no mock e falha na API real é um bug da API real (ou uma decisão a registrar em ADR).
- **Troque módulo a módulo.** `NEXT_PUBLIC_API_MOCK` aceita `all`, `none` ou uma lista de módulos (`auth,games`). Cada issue de API termina com aquele módulo saindo da lista, as telas funcionando contra a API real e os E2E correspondentes passando contra o preview.
- **Peças do front já preparadas para a troca:**
  - `apps/web/shared/realtime/` — interface `RealtimeClient`; troque `MockRealtimeClient` por uma implementação com Ably (B2.9) sem mudar as telas.
  - `apps/web/shared/api/upload.ts` — `uploadImage` já faz o fluxo de token + envio direto; aponte para o Vercel Blob (B1.4).
  - `apps/web/shared/flags/` — `useFlag` lê `/site/flags`; no servidor, leia do Edge Config (B2.6).
  - `apps/web/shared/api/client.ts` — cliente único; nenhuma tela chama `fetch` direto.
- **O motor (`packages/engine`) é reaproveitado sem mudanças.** `apps/web/mocks/competition.ts` mostra como o contrato vira entrada do motor (`toEngineConfig`, `toEngineQualification`, `buildMatch`, `buildStandings`); leve essa adaptação para a API.

## 3. Ordem de trabalho

### Passo 0 — antes do B1: lacunas que ficaram de F1/F2

Abra uma issue para cada item (label `lacuna`, milestone do módulo correspondente) e corrija os que dependem só de código, um PR por item ou por grupo pequeno:

1. `/ranking` conta só campeonatos disputados: passar a usar os resultados das partidas (títulos, vitórias, kills/placar), como `mocks/handlers/profile-stats.ts` já faz para o perfil.
2. O fuso horário salvo no perfil (`Me.timezone`) não é aplicado: `shared/lib/datetime.ts` usa sempre o fuso do navegador.
3. A reserva de 24 h do squad promovido da lista de espera (RN-12) não vence quando a organização remove um inscrito (`mocks/handlers/registrations-manage.ts`).
4. Dois componentes de anexo de provas fazem a mesma coisa (`features/organizer/operation/results/EvidenceUpload.tsx` e `features/disputes/evidence/EvidenceUploader.tsx`): unificar. Expor progresso de envio em `shared/api/upload.ts`.
5. Sem teste E2E: "gerar próxima rodada" do suíço, ordem manual da chave, kills por jogador e importação de resultados em vários lotes. A arte de resultado (`/c/[slug]/arte`) foi conferida só no Chromium.

Itens que dependem do dono do projeto e ficam com ele: #8 (conectar a Vercel e ter preview por PR), #14 (publicar o Storybook), #32 (teste de usabilidade com 3 pessoas), #63 (validar o protótipo com 3 organizadores e 5 jogadores — Marco M1) e #4 (proteção de branch e licença). Quando #8 estiver feito, defina a variável `PLAYWRIGHT_BASE_URL` do repositório para os E2E do CI rodarem contra o preview.

### Passo 1 — B1 · Fundação e Núcleo (issues #64 a #81, épico #129)

Ordem sugerida: #64 → #65 → #66 → #71 → #67 → #80 → #68 → #70 → #69 → #72 → #73 → #74 → #75 → #76 → #78 → #79 → #77 → #81.

- #64 exige contas e recursos pagos (Vercel Pro, Neon, Upstash, QStash, Resend, Sentry pelo Marketplace). **Prepare tudo o que for código e configuração, liste exatamente o que o dono precisa criar ou autorizar e pare para ele fazer.** Nunca crie conta nem contrate serviço.
- Cada issue de API traz testes de integração (Vitest + `app.request` + Postgres em contêiner), teste de contrato (resposta validada pelo schema de `packages/schemas`) e a matriz RBAC daquelas rotas (cada rota × visitante, participante, organizador, admin → 401/403/200).
- CT-02 (100 inscrições simultâneas para 10 vagas → 10 confirmadas e 90 na lista de espera) roda também contra o preview.
- Saída do B1: telas de F1 100% na API real no preview e em staging; matriz RBAC passando para as rotas existentes.

### Passo 2 — B2 · Competição, Governança e Tempo Real (issues #82 a #102, épico #130)

Ordem sugerida: #99 (jobs e Cron, base de tudo o que é agendado) → #82 → #83 → #84 → #85 → #86 → #87 → #88 → #100 → #90 → #97 → #98 → #95 → #91 → #92 → #93 → #94 → #96 → #89 → #101 → #102.

- Pontos sempre calculados no servidor pelo motor (RN-01). `Idempotency-Key` no Upstash Redis por 24 h.
- O código da sala é cifrado (AES-256-GCM) e nunca vai em evento de tempo real.
- O tempo real publica **depois do commit** e só "o que mudou"; o polling de 10 s continua como alternativa (CT-10).
- 2FA (#95): além de proteger `/admin`, o login passa a pedir o código para quem tem 2FA ativo — isso não existe no protótipo.
- Saída do B2 (Marco M2): nenhuma tela usa o mock; CT-01 a CT-10 passando em staging; 100% das ações sensíveis auditadas.

### Passo 3 — R1 · Responsividade, Acessibilidade e PWA (issues #103 a #110, épico #131)

### Passo 4 — R2 · Desempenho, Segurança e Lançamento (issues #111 a #119, épico #132)

Inclui a revisão OWASP, LGPD (exportação e exclusão com anonimização, conforme `docs/modelo-de-dados.md`), observabilidade, backup e rollback testados, beta fechado e o checklist de produção (Marco M3).

**Antes de produção, remova os atalhos que só existem no protótipo** (listados em `apps/web/README.md`): `POST /auth/dev-login`, `GET /me/2fa/dev-code`, os tokens `devVerifyToken`/`devResetToken` nas respostas, o link de redefinição mostrado ao Admin e o seletor "Entrar como" (`shared/layout/DevSwitcher.tsx`). Arquivos que hoje os usam: `features/auth/{VerifyEmailScreen,ForgotPasswordScreen,RegisterScreen}.tsx`, `features/profile/security/TwoFactorSection.tsx`, `shared/api/hooks/{users,admin-security}.ts`, `shared/session/useSession.ts`, `app/providers.tsx`.

## 4. Regras de trabalho

- Uma branch e um PR por issue (ou grupo pequeno de issues ligadas), saindo da `main` atualizada (`git fetch` antes — outra pessoa também envia PRs). Corpo do PR com `Closes #n`, o que muda, como testar e o resultado da verificação. Conventional Commits.
- Nunca envie direto para a `main`, nunca faça merge com o CI vermelho e não force push em branch compartilhada.
- Definição de Pronto (plano §4.1): lint, tipos, testes e E2E verdes; tela em 360 px e 1440 px com estados de carregando, vazio e erro; permissão verificada no back-end; ação sensível auditada; nenhum segredo no código, variáveis cadastradas na Vercel para Preview, Staging e Produção.
- Verificação antes de abrir o PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm check:colors && pnpm build`, e os E2E afetados.
- Use as skills e os agents de `.claude/` conforme a tabela do `CLAUDE.md`: no back-end, `backend-patterns`, `api-design`, `contract-first`, `prisma-patterns`, `postgres-patterns`, `database-migrations`, `redis-patterns`, `security-review` e as skills `vercel:*` (`vercel:vercel-functions`, `vercel:vercel-storage`, `vercel:env-vars`, `vercel:deployments-cicd`); revisão com os agents `database-reviewer`, `security-reviewer` e `typescript-reviewer`.
- Migrations sempre compatíveis com a versão anterior (o rollback da Vercel é instantâneo; o do banco não).
- Ao terminar cada issue, comente nela o que ficou parcial. Feche a issue só pelo merge do PR.

## 5. Particularidades do ambiente (já custaram tempo)

- O CI roda em UTC. Testes de tela que dependem de fuso usam `TZ=America/Sao_Paulo` (já fixado em `apps/web/vitest.config.ts`); rode `TZ=UTC pnpm test` antes de abrir PR.
- O hook de pré-push (lefthook) roda `pnpm typecheck` na pasta de trabalho: com arquivos não commitados quebrados, o push falha.
- `PLAYWRIGHT_BASE_URL` vazia significa "subir o app no próprio runner". Para rodar duas instâncias ao mesmo tempo, use `NEXT_DIST_DIR=.next-<nome>` e `PW_OUTPUT_DIR=test-results-<nome>`.
- Com a máquina sobrecarregada, alguns E2E estouram tempo; rode de novo só a suíte afetada antes de concluir que é bug.
- O PR #144 (TypeScript 7) está bloqueado: o `typescript-eslint` ainda não suporta essa versão. Não force.
- O ESLint 10 está em uso, mas `eslint-plugin-react`, `eslint-plugin-import` e `eslint-plugin-jsx-a11y` (via `eslint-config-next`) ainda não declaram suporte a ele. Se o lint se comportar de forma estranha, comece por aí.

## 6. Decisões já tomadas (mantenha, salvo decisão do dono)

Estão em `docs/adr/0001-decisoes-iniciais.md` e `docs/regras-de-negocio.md`. Outras foram tomadas durante F1 e F2 e valem como especificação até alguém decidir diferente — se for mudar, registre em uma nova ADR:

- Feature flags e configurações globais: só o Super Admin altera. Toda rota `/admin/*` exige 2FA ativo.
- Só o Super Admin sanciona ou redefine a senha de outro Admin; conta de Admin não pode ser a origem de uma mescla.
- Moderador do campeonato pode validar resultados, listar, escalar e resolver disputas; não gera chave, não cancela e não desclassifica. Disputa escalada só é resolvida por Admin.
- Convite de squad por link ou código vale para várias pessoas até expirar (72 h); por apelido, é de uso único. Tentativas de código limitadas a 10 erradas por minuto.
- Na tabela de mata-mata, quem segue vivo fica acima de quem foi eliminado, mesmo com menos pontos.
- Organizador revogado ou banido: o co-organizador mais antigo assume; sem ele, o campeonato pausa e entra na fila "Sem responsável" (RN-09). O campeonato continua pausado quando ganha novo dono; quem retoma é o novo dono.

## 7. Quando parar e perguntar

Pare e pergunte ao dono do projeto antes de: criar conta, contratar ou mudar plano de qualquer serviço; apagar dados de qualquer ambiente; mexer em produção; mudar uma regra de negócio ou uma decisão das seções acima; fazer merge de PR. Em todo o resto, siga sozinho e relate no PR o que decidiu.
````
