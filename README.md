# 🟢 Nova Arena

Plataforma web para criar, organizar, operar e acompanhar campeonatos online de jogos competitivos (Free Fire, Clash Royale, 8 Ball Pool, eFootball e outros cadastráveis).

O produto roda **100% na Vercel**: um único app Next.js com telas e API, mais serviços serverless (Neon, Upstash, Ably, Resend, Vercel Blob).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/prd.md`](docs/prd.md) | Requisitos de produto, UX e arquitetura |
| [`docs/plano-de-implementacao.md`](docs/plano-de-implementacao.md) | Fases, entregas, testes e critérios de saída |
| [`docs/regras-de-negocio.md`](docs/regras-de-negocio.md) | Regras complementares (RN-06 em diante) |
| [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md) | Entidades, enums e regras de exclusão |
| [`docs/adr/`](docs/adr/) | Decisões de arquitetura e de produto |

## Como rodar

Requisitos: Node.js 22 ou mais novo (o projeto usa a versão do `.nvmrc`) e pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm dev          # http://localhost:3000 — com a API simulada (MSW)
```

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe o app com a API simulada |
| `pnpm build` | Build de produção |
| `pnpm lint` · `pnpm typecheck` | Lint e checagem de tipos |
| `pnpm test` · `pnpm test:coverage` | Testes unitários e de componente |
| `pnpm e2e` | Testes E2E (Playwright) |
| `pnpm storybook` | Storybook do design system |

No protótipo, use o seletor **"Entrar como"** (canto inferior da tela) para alternar entre participante, capitão, organizador e administrador.

## Estrutura

```
apps/web/          Next.js (App Router) — único projeto publicado na Vercel
packages/ui/       Design system "Nova Green" + Storybook
packages/schemas/  Contratos Zod compartilhados entre telas, mock e API
packages/engine/   Motor de chaveamento e pontuação (TypeScript puro)
packages/config/   tsconfig e ESLint compartilhados
docs/              PRD, plano, regras e ADRs
.claude/           Skills e agents usados no desenvolvimento
```

## Como contribuir

1. Pegue uma issue do marco em andamento e confira as dependências dela.
2. Crie uma branch (`feat/...`, `fix/...`) e abra um Pull Request com `Closes #n`.
3. Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat:`, `fix:`, `test:`, `docs:`…). O hook de commit recusa mensagens fora do padrão.
4. O PR precisa de lint, tipos e testes verdes, e de uma revisão.

A Definição de Pronto está no [plano §4.1](docs/plano-de-implementacao.md#41-definição-de-pronto) e no modelo de PR.

## Skills e agents

O repositório versiona em `.claude/` as skills e os agents usados no projeto (origem: [`vercel-labs/skills`](https://github.com/vercel-labs/skills), [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) e [`affaan-m/ECC`](https://github.com/affaan-m/ECC)). Quem abre o projeto no Claude Code já os tem disponíveis. O mapa "tipo de tarefa → skill/agent" está no [`CLAUDE.md`](CLAUDE.md).
