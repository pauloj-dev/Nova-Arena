# ADR-0003 — Rating ELO da temporada, recalculado do histórico, e ligas semanais

- **Status:** aceita
- **Data:** 2026-11-21
- **Issue:** #120 (pós-lançamento; PRD §5.3, plano §11 melhoria 9)

## Contexto

O ranking de `/ranking` (ADR-0001) ordena por títulos e vitórias: não diz quem é mais forte agora, nem serve para o
seeding `RANKED` da primeira fase. A issue #120 pede um rating por jogo e por temporada, atualizado a cada partida
validada (duelos, equipe x equipe e quedas de Battle Royale), com histórico por pessoa e por squad, e ligas semanais que
somam pontos por colocação. Restrições: tudo na Vercel (sem worker contínuo), o motor é TypeScript puro e testado por
propriedade, e outras frentes mexem no fluxo de resultados ao mesmo tempo.

## Decisão

### 1. ELO, não Glicko

ELO clássico (`K = 32`, escala 400, rating inicial 1000), em `packages/engine/src/rating`.

- **Por quê:** o que um ganha o outro perde (soma conservada, fácil de explicar ao jogador e de testar por propriedade),
  uma constante só para calibrar e nada de "desvio" para mostrar na tela. O Glicko trataria melhor a incerteza de quem
  jogou pouco, mas exige período de rating e três números por pessoa; aqui a incerteza vira o selo **"Provisório"** nas
  primeiras 5 partidas da temporada.
- `K` não muda com o número de partidas (um K maior para novatos quebraria a conservação da soma).

### 2. Partidas com mais de dois lados (Battle Royale)

Uma queda com N equipes vira **todos os pares**: em cada par, a equipe mais bem colocada vence (colocação igual =
empate), e cada par vale `K / (N − 1)`. A variação da equipe é a soma dos pares. Assim:

- num duelo (N = 2) é exatamente o ELO clássico;
- a soma das variações da queda é zero, e nenhuma equipe ganha ou perde mais de `K` numa queda (como num duelo);
- ganhar a queda contra equipes fortes vale mais do que contra fracas.

Equipe **ausente** na queda não entra (como o W.O., não houve jogo). Dividir o 1º lugar não conta como vitória.

### 3. Jogadores e squads

Dois conjuntos independentes: **jogadores** (cada lado vale a média do rating dos seus jogadores; a variação do lado vai
para cada um) e **squads** (só lados que são um squad cadastrado). Inscrição importada, sem conta, joga com o rating
inicial e não aparece na tabela (é a única situação em que a soma do conjunto não fica exatamente conservada).

### 4. O rating não é gravado: é um replay do histórico

O rating de uma temporada é recalculado do zero pelo motor (`replayRatings`) a partir das partidas validadas do jogo
dentro da janela da temporada, lidas do retrato do motor de cada fase (ADR-0002). A ordem é a da **primeira validação**
de cada partida (primeiro evento em `result_events`; sem evento, o horário marcado; empate desfeito pelo id).

- Corrigir, anular (desistência, desclassificação) ou cancelar o campeonato muda o rating sem código de "desfazer": o
  próximo replay já sai certo. Não há gancho no fluxo de resultados — nada muda em `applyMatchResult`.
- **Cache por versão** (Redis, 10 min): a chave leva o maior id de `result_events` do jogo e o número de campeonatos
  cancelados. Resultado novo = versão nova = recálculo na próxima leitura ("atualizado a cada partida validada").
- Não contam: W.O., resultado anulado, vaga de bye, campeonato cancelado ou que não começou.
- Custo: lê os retratos das fases do jogo. Para o volume do lançamento (centenas de campeonatos por jogo e temporada) é
  de milissegundos depois do cache; se crescer, grava-se um retrato do replay por temporada (mesma função do motor).

### 5. Temporadas

Tabela `seasons` (por jogo, início inclusivo e fim exclusivo, sem sobreposição no mesmo jogo — a API devolve 409
`SEASON_OVERLAP`). Cada temporada recomeça todo mundo em 1000. Só o Admin cria, edita e apaga (auditado,
`SEASON_CHANGED`). O seed cria a temporada do ano para cada jogo. Sem temporada em andamento, vale a última que já
começou (para o perfil) e a tabela do jogo mostra o estado vazio.

### 6. Seeding `RANKED`

Na primeira fase, o seeding por ranking passa o rating da temporada atual ao motor (`Entrant.rating`): squad → rating do
squad (ou a média dos jogadores); solo → o do jogador; quem não jogou → 1000. Se ninguém da chave tem rating, nada muda.
As fases seguintes continuam usando a classificação da fase anterior.

### 7. Ligas semanais

Tabelas `leagues` e `league_tournaments` (um campeonato em no máximo uma liga). A liga é de um organizador e de um jogo,
tem período e uma regra de pontos configurável (pontos por colocação, não crescentes, mais pontos de participação; padrão
25, 18, 15, 12, 10, 8, 6, 4, 2, 1 + 1). Só campeonatos **encerrados** somam. Colocação final (`finalPlacements`): o pódio,
depois a ordem da tabela da última fase e de quem parou nas fases anteriores. Pontua o jogador (solo), o squad (equipe)
ou o nome (inscrição importada). Desempate: títulos, melhor colocação, campeonatos jogados. Mudanças auditadas
(`LEAGUE_CHANGED`).

## Consequências

- Motor: `ratingDeltas`, `replayRatings`, `rankRatings`, `ratingMatchesFromStage`, `finalPlacements`,
  `computeLeagueTable`, com testes de propriedade (soma conservada no duelo e na queda, ordem irrelevante para partidas
  independentes e para a ordem do array, colocações únicas, soma dos pontos da liga).
- A API real e a simulada usam as mesmas funções; as rotas são conferidas por um teste de paridade.
- A migration `pos_a_ranking_temporada_ligas` só cria tabelas (compatível com o código anterior).
- Trocar K, escala ou rating inicial muda todas as tabelas na próxima leitura (é um replay) — anunciar antes.
