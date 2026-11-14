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

## Novo módulo

1. `src/modules/<nome>/index.ts` exporta `new Hono<AppEnv>()` com as rotas.
2. Registre em `modules` no `src/app.ts`.
3. Entrada com `body(c, Schema)`, saída com `respond(c, Schema, data)`; erros com `HttpProblem`.
4. Teste com `createApp({ env: envFrom({...}), deps })` e `app.request('/api/v1/...')`: cada rota × visitante, participante, organizador e admin (401/403/200), e a resposta validada pelo schema.
5. Tire o módulo de `NEXT_PUBLIC_API_MOCK` quando as telas funcionarem contra ele.

## Comandos

```bash
pnpm --filter @nova/api test
pnpm --filter @nova/api typecheck
```

`GET /api/v1/health` responde o estado do banco, do Redis e do QStash (200 `ok` ou `degraded`; 503 quando algo configurado está fora). A verificação do banco entra com `packages/db` (issue #66).
