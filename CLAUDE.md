# Nova Arena — guia para agentes

Plataforma de campeonatos de eSports mobile. Leia `docs/prd.md` (o quê) e `docs/plano-de-implementacao.md` (como e quando) antes de qualquer tarefa. Regras complementares: `docs/regras-de-negocio.md`. Entidades: `docs/modelo-de-dados.md`. Decisões: `docs/adr/`.

## Stack

- Monorepo pnpm + Turborepo. Um único app: `apps/web` (Next.js App Router, React 19, TypeScript estrito, Tailwind v4).
- `packages/ui` (design system sobre Radix UI), `packages/schemas` (Zod), `packages/engine` (TypeScript puro, sem Node nem DOM), `packages/config`.
- A partir de B1: `packages/api` (Hono em Vercel Functions) e `packages/db` (Prisma + Neon).
- Hospedagem 100% Vercel. Não proponha servidor contínuo, WebSocket próprio nem fila com worker.
- O Next.js deste projeto tem mudanças em relação a versões antigas: consulte `apps/web/node_modules/next/dist/docs/` antes de usar uma API da qual não tem certeza (`proxy.ts` substitui `middleware.ts`; `params` e `searchParams` são `Promise`).

## Comandos

```bash
pnpm dev            # app com API simulada (MSW)
pnpm lint && pnpm typecheck && pnpm test
pnpm e2e            # Playwright
pnpm storybook
```

## Regras do projeto

1. **Uma fonte de verdade para contratos:** toda entidade, requisição e resposta tem schema em `packages/schemas`. Telas, mock e API importam de lá.
2. **Nenhuma tela chama `fetch` direto:** tudo passa por `apps/web/shared/api` (cliente único + query keys). É isso que permite trocar o mock pela API real.
3. **Pontos nunca vêm do cliente:** a pontuação é sempre calculada por `packages/engine` a partir das estatísticas brutas.
4. **Nenhuma cor fora dos tokens:** use as classes do Tailwind ligadas aos tokens (`bg-primary-600`, `text-muted`…), nunca hex solto.
5. **Mobile primeiro:** toda tela funciona em 360 px e 1440 px, com estados de carregando, vazio e erro.
6. **Acessibilidade AA:** navegação por teclado, foco visível, status com ícone + texto (não só cor).
7. **Datas em UTC**, exibidas no fuso do usuário com `shared/lib/datetime`.
8. **Textos em pt-BR**, escritos para o jogador e o organizador, não para o desenvolvedor.
9. Commits em Conventional Commits. Um PR por issue (ou grupo pequeno de issues ligadas), com `Closes #n`.

A Definição de Pronto completa está no plano §4.1.

## Mapa: tipo de tarefa → skill e agent

As skills e os agents ficam em `.claude/skills` e `.claude/agents`. As skills `vercel:*` vêm do plugin da Vercel (instalação por usuário).

| Tarefa | Skills | Agents |
|---|---|---|
| Planejar uma fase ou issue grande | `find-skills`, `architecture-decision-records` | `planner`, `architect` |
| Telas e componentes React/Next.js | `vercel-react-best-practices`, `vercel-composition-patterns`, `frontend-patterns`, `react-patterns`, `vercel:nextjs` | `react-reviewer`, `typescript-reviewer` |
| Design system e UI | `web-design-guidelines`, `frontend-design-direction`, `ui-ux-pro-max`, `ui-styling` | `a11y-architect` |
| Acessibilidade | `accessibility`, `frontend-a11y` | `a11y-architect` |
| Motor (`packages/engine`) | `tdd-workflow`, `typescript-patterns` | `tdd-guide`, `type-design-analyzer` |
| API e contratos | `backend-patterns`, `api-design`, `contract-first`, `error-handling`, `vercel:vercel-functions` | `architect`, `code-reviewer` |
| Banco | `prisma-patterns`, `postgres-patterns`, `database-migrations` | `database-reviewer` |
| Cache, jobs e filas | `redis-patterns`, `vercel:vercel-functions` | `silent-failure-hunter` |
| Segurança | `security-review`, `security-scan`, `vercel:vercel-firewall` | `security-reviewer` |
| Testes E2E | `e2e-testing`, `browser-qa`, `verification-loop` | `e2e-runner`, `pr-test-analyzer` |
| Desempenho | `react-performance`, `vercel-optimize`, `vercel:cdn-caching` | `performance-optimizer` |
| Deploy e ambientes | `deployment-patterns`, `git-workflow`, `vercel:deployments-cicd`, `vercel:env-vars` | `build-error-resolver` |
| i18n e SEO | `i18n-sync`, `seo` | `seo-specialist` |
| Documentação | `docs-governance`, `architecture-decision-records` | `doc-updater` |

Os hooks do ECC **não** foram instalados. Só entram com decisão do time.
