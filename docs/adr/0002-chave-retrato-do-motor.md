# ADR-0002 — Chave guardada como retrato do motor, com projeção em tabelas

- **Status:** aceita
- **Data:** 2026-11-16
- **Issue:** #82 (B2.1)

## Contexto

O `packages/engine` gera e evolui as chaves de forma imutável: recebe `structure` (participantes, grupos, partidas e
de onde vem cada vaga) e `state` (resultados, desistências, partidas puladas) e devolve um novo par. Toda operação
de competição das próximas issues (resultados, W.O., desistência, avanço de fase, suíço) é uma chamada ao motor sobre
esse par. Ao mesmo tempo, telas e jobs precisam consultar partidas (minhas partidas, agenda, check-in, tempo real).

## Decisão

1. **Fonte da verdade do motor:** o par `structure + state` fica em `stages.engineSnapshot` (JSONB), junto com a
   flag `stages.unlocked` (RN-07). Toda mudança lê o retrato, chama o motor e grava o retrato novo na mesma transação.
2. **Projeção para consulta:** depois de cada mudança, `groups`, `group_members`, `matches` e `match_participants` são
   atualizados a partir do retrato (`matches` é única por `stageId + nodeId`, então a projeção é idempotente). Dados que
   não são do motor (horário, código da sala, provas, check-in) ficam só nas tabelas e nunca são apagados pela projeção.
3. A semente do sorteio fica em `stages.randomSeed`: a mesma semente reproduz a mesma chave (ADR-0001/ADR-007 do plano).

## Consequências

- O motor continua puro e testável sem banco; a API não reimplementa regra de chave.
- Uma mudança na estrutura do motor exige migração do JSON (versão do retrato) — registrar quando acontecer.
- A projeção custa algumas escritas por mudança; com as chaves do produto (até 1.024 participantes) é aceitável.
