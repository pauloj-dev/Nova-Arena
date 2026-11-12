# ADR-0001 — Decisões iniciais do projeto

- **Status:** aceita
- **Data:** 12/11/2026
- **Issue:** #1
- **Contexto:** o PRD (§25) lista questões em aberto que travam telas, schemas e regras. Elas foram decididas aqui para destravar a fase F1. Toda decisão marcada como *provisória* pode ser revista sem retrabalho grande, porque o valor fica em configuração.

## Decisões

| # | Questão | Decisão | Onde fica no código |
|---|---|---|---|
| Q1 | Tamanho máximo da sala Battle Royale | **12 equipes por sala** como padrão (48 jogadores em squad). Configurável por fase entre 2 e o limite do modo do jogo (`GameMode.maxLobbySize`). | `StageConfig.lobbySize` |
| Q3 | Final BR com poucos finalistas: completar a sala por repescagem? | **Desligado por padrão.** A fase tem a opção "completar a sala com os N melhores eliminados" (`qualification.repechage`). | `Stage.qualification` |
| Q5 | Idade mínima para cadastro | **16 anos** *(provisória — precisa de validação jurídica antes do beta)*. O cadastro pede data de nascimento e recusa quem está abaixo. | `MIN_AGE` (configuração do site) |
| Q6 | Kills por jogador obrigatórias para o ranking de MVP? | **Opcional por fase.** O padrão é lançar kills por equipe. O ranking de MVP só aparece nas fases com `killsPerPlayer = true`. | `StageConfig.killsPerPlayer` |
| Q7 | Domínio definitivo | **`novaarena.gg`** *(provisória — depende da compra do domínio)*. O código nunca fixa o domínio: usa `NEXT_PUBLIC_SITE_URL`. | variável de ambiente |
| — | Linguagem | **TypeScript estrito** em todo o monorepo (ecossistema JavaScript, 100% na Vercel). JavaScript puro foi descartado porque os contratos Zod compartilhados e o motor de chaveamento dependem de tipos para serem seguros. | `packages/config/tsconfig.base.json` |
| — | `/ranking` na v1 | Entra na v1 como **ranking por jogo com dados existentes** (títulos, vitórias, kills/coroas), atrás da flag `ranking`. Sem ELO/MMR (isso é pós-lançamento). | flag `ranking` |

## Questões que continuam abertas (fora da v1)

| # | Questão | Situação |
|---|---|---|
| Q2 | Parceria ou API oficial para importar resultados | Pós-lançamento (issue #123) |
| Q4 | Cobrança de inscrição e modelo de taxa | Pós-lançamento (issue #122) |

## Consequências

- Os schemas de `packages/schemas` e os formulários do assistente de criação usam esses padrões.
- A idade mínima e o domínio precisam ser confirmados antes do beta (checklist de produção, plano §10).
