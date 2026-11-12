# @nova/engine

Motor de chaveamento e pontuação da Nova Arena. TypeScript puro: não importa nada de Node, do navegador nem de bibliotecas, então roda igual na tela (prévia) e nas funções da Vercel.

```ts
import { computePoints, generateStage, applyResult, computeStandings, advanceStage } from '@nova/engine';
```

Tudo o que entra e sai é JSON serializável. Nenhuma função altera o que recebe: todas devolvem objetos novos.

Regras que valem para o pacote inteiro:

- **Pontos nunca vêm do cliente** (RN-01). As telas mandam estatísticas brutas e o motor calcula.
- **Erros de regra** são `EngineError`, com `code` (para a tela decidir o que fazer) e `message` em pt-BR (pronta para exibir).
- **Tudo é determinístico**: mesma entrada e mesma seed geram a mesma saída, com os mesmos ids de partida.

---

## 1. Pontuação

### Tipos

```ts
type Stats = Record<string, number | string | undefined>;

type Rule =
  | { type: 'PER_UNIT'; stat: string; points: number }
  | { type: 'TABLE'; stat: string; table: Record<string, number> }
  | { type: 'OUTCOME'; win: number; draw: number; loss: number } // lê stats.outcome: 'win' | 'draw' | 'loss'
  | { type: 'BONUS'; stat: string; op: 'gte' | 'lte' | 'eq'; value: number; points: number }
  | { type: 'CAP'; stat: string; max: number }
  | { type: 'MULTIPLIER'; factor: number; when?: { matchIndex?: number | 'last' } };

type Tiebreaker =
  | 'points' | 'wins' | 'booyahs' | 'kills' | 'score'
  | 'avgPlacement' | 'headToHead' | 'scoreDiff' | 'lastDropKills' | 'draw';

interface ScoringModel {
  id: string;
  name: string;
  gameSlug: string;
  matchType: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE';
  rules: Rule[];
  tiebreakers: Tiebreaker[];
  isDefault?: boolean;
}

interface ScoringContext { matchIndex?: number; matchCount?: number; multiplier?: number }
interface PointsBreakdownItem { ruleIndex: number; type: Rule['type']; stat?: string; points: number; label: string }
interface PointsResult { total: number; breakdown: PointsBreakdownItem[] }
```

### `computePoints`

```ts
function computePoints(stats: Stats, rules: Rule[], ctx?: ScoringContext): PointsResult;
```

```ts
computePoints({ kills: 7, placement: 1 }, [
  { type: 'PER_UNIT', stat: 'kills', points: 1 },
  { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
]);
// { total: 10, breakdown: [
//   { ruleIndex: 0, type: 'PER_UNIT', stat: 'kills', points: 7, label: '7 × 1 pt (kills)' },
//   { ruleIndex: 1, type: 'TABLE', stat: 'placement', points: 3, label: 'placement 1 → 3 pts' } ] }
```

Como o cálculo funciona:

1. Regras que pontuam (`PER_UNIT`, `TABLE`, `OUTCOME`, `BONUS`).
2. `CAP`: limita a soma dos pontos vindos daquele `stat` (de qualquer regra, declarada antes ou depois). No detalhamento aparece como valor negativo.
3. `MULTIPLIER`: multiplica o total da partida. Sem `when`, vale sempre; com `when.matchIndex`, só naquela partida/queda.
4. `ctx.multiplier` (o `multiplier` da partida) entra por último, com `ruleIndex: -1`.

Detalhes:

- `matchIndex` **começa em 1** (queda 1, queda 2…). `'last'` exige `ctx.matchIndex === ctx.matchCount`.
- Estatística ausente, vazia ou não numérica vale **0 ponto e nunca lança** — inclusive em `BONUS` (sem o dado, o bônus não é dado) e em `TABLE` (não procura a chave `"0"`).
- O `breakdown` tem um item por regra, na ordem das regras, mesmo quando a regra somou 0. A soma dos `points` é igual ao `total`.

```ts
// Limite de 15 pts de kill e última queda valendo ×2
computePoints(
  { kills: 20, placement: 1 },
  [
    { type: 'PER_UNIT', stat: 'kills', points: 1 },
    { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
    { type: 'CAP', stat: 'kills', max: 15 },
    { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } },
  ],
  { matchIndex: 5, matchCount: 5 },
).total; // (15 + 3) × 2 = 36
```

### `validateScoringModel`

```ts
function validateScoringModel(model: ScoringModel): string[]; // mensagens em pt-BR; [] = válido
```

```ts
validateScoringModel({ ...modelo, rules: [{ type: 'CAP', stat: 'assists', max: 5 }] });
// ['Adicione ao menos uma regra de pontuação.']
validateScoringModel({ ...modelo, rules: [{ type: 'PER_UNIT', stat: '', points: 1 }] });
// ['Regra 1: informe a estatística.']
```

### `DEFAULT_SCORING_MODELS` e `TIEBREAKERS`

```ts
const DEFAULT_SCORING_MODELS: ScoringModel[];
const TIEBREAKERS: readonly Tiebreaker[]; // todos os critérios aceitos
```

| `id` | Jogo (`gameSlug`) | `matchType` | Regras | Estatísticas lidas |
|---|---|---|---|---|
| `ff-br-padrao` | `free-fire` | `BATTLE_ROYALE` | 1 por kill + 3 pelo Booyah | `kills`, `placement` |
| `ff-br-liga` | `free-fire` | `BATTLE_ROYALE` | 12/9/8/7/6/5/4/3/2/1/0/0 por colocação + 1 por kill | `placement`, `kills` |
| `ff-contra-squad` | `free-fire` | `TEAM_VS_TEAM` | vitória 3 | `outcome` |
| `cr-1v1`, `cr-2v2` | `clash-royale` | `DUEL` | 1 por coroa + 3 por vitória | `crowns`, `outcome` |
| `efootball-1v1` | `efootball` | `DUEL` | 3 / 1 / 0 | `outcome` |
| `8ball-1v1` | `8-ball-pool` | `DUEL` | 1 por frame + 3 por vitória de série | `frames`, `outcome` |

Todos têm `isDefault: true`, menos o `ff-br-liga`.

```ts
const ff = DEFAULT_SCORING_MODELS.find((m) => m.id === 'ff-br-padrao')!;
computePoints({ kills: 9, placement: 2 }, ff.rules).total; // 9
```

---

## 2. Chaveamento

### Tipos

```ts
type StageFormat = 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'GROUPS' | 'ROUND_ROBIN' | 'SWISS' | 'BATTLE_ROYALE' | 'TEAM_VS_TEAM';
type SeedingMethod = 'RANDOM' | 'RANKED' | 'MANUAL';

interface Entrant { id: string; name?: string; seed?: number; rating?: number }

interface MatchSlot {
  entrantId: string | null;
  source?: { matchId: string; outcome: 'winner' | 'loser' }; // de onde vem o ocupante
  isBye?: boolean;                                           // o ocupante desta vaga recebeu bye
}

interface MatchNode {
  id: string;
  round: number;
  position: number;
  bracket: 'WINNERS' | 'LOSERS' | 'FINAL' | 'THIRD_PLACE' | null;
  groupId: string | null;
  kind: 'DUEL' | 'LOBBY';
  slots: MatchSlot[];
  bestOf: number;
  nextMatchId: string | null;
  loserNextMatchId: string | null;
  dropIndex?: number;     // queda (BR), começando em 1
  multiplier?: number;    // multiplicador da queda
  ifNecessary?: boolean;  // reset da Grande Final
  roundLabel: string;     // pt-BR
}

interface StageGroup { id: string; name: string; entrantIds: string[] }

interface StageConfig {
  bestOf?: number;            // 1, 3, 5 ou 7 (padrão 1)
  thirdPlace?: boolean;       // SINGLE_ELIM / TEAM_VS_TEAM (padrão false)
  stopAtRemaining?: number;   // SINGLE_ELIM / TEAM_VS_TEAM: para quando restarem N (potência de 2; padrão 1)
  grandFinalReset?: boolean;  // DOUBLE_ELIM (padrão true)
  groupCount?: number;        // GROUPS
  groupSize?: number;         // GROUPS: alternativa a groupCount (padrão 4; 12 em quedas BR)
  groupMode?: 'ROUND_ROBIN' | 'BATTLE_ROYALE'; // GROUPS (padrão 'ROUND_ROBIN')
  doubleRound?: boolean;      // ROUND_ROBIN / GROUPS: turno e returno (padrão false)
  rounds?: number;            // SWISS (padrão ceil(log2 N))
  lobbySize?: number;         // BATTLE_ROYALE (padrão 12)
  drops?: number;             // BATTLE_ROYALE / GROUPS em quedas (padrão 1)
  dropMultipliers?: number[]; // índice 0 = queda 1; ausente = 1
  killsPerPlayer?: boolean;   // só repassado (ADR-0001 Q6)
  walkoverScore?: number;     // placar do vencedor em W.O. de jogo único (padrão 3)
}

interface StageStructure {
  format: StageFormat;
  seedUsed: string;        // seed do sorteio — guarde para auditoria
  seeding: SeedingMethod;
  config: StageConfig;     // com os padrões já aplicados
  entrants: Entrant[];     // na ordem das seeds; `seed` preenchido de 1 a N
  groups: StageGroup[];    // grupos (GROUPS) ou salas (BATTLE_ROYALE); [] nos demais
  matches: MatchNode[];
  rounds: number;          // rodadas previstas (DOUBLE_ELIM: rodadas da chave de vencedores)
}
```

### `generateStage`

```ts
function generateStage(input: {
  format: StageFormat;
  entrants: Entrant[];
  config?: StageConfig;
  seeding: SeedingMethod;
  seed?: string;
}): StageStructure;
```

```ts
const chave = generateStage({
  format: 'SINGLE_ELIM',
  entrants: inscritos, // [{ id, name }]
  seeding: 'RANDOM',
  seed: 'copa-verao-2026', // omita para o motor sortear uma; ela volta em chave.seedUsed
  config: { bestOf: 3, thirdPlace: true },
});
```

Seeding:

- `RANDOM`: sorteio determinístico a partir de `seed`. Sem `seed`, o motor sorteia uma e devolve em `seedUsed` (para regerar a chave, RN-07, chame de novo sem `seed`).
- `RANKED`: por `seed` (menor primeiro); quem não tem `seed`, por `rating` (maior primeiro); depois a ordem recebida. O cruzamento é o padrão 1 × último (1-16, 8-9…).
- `MANUAL`: a ordem recebida.

Nos três, participante repetido ou sem `id` lança `EngineError('INVALID_ENTRANTS')`. O mínimo é 2 participantes.

O que cada formato gera:

| Formato | Partidas | Ids | `roundLabel` |
|---|---|---|---|
| `SINGLE_ELIM`, `TEAM_VS_TEAM` | N−1 (+1 com `thirdPlace`, a partir de 4) | `w-r1-m1`, `3rd` | `Final`, `Semifinal`, `Quartas de final`, `Oitavas de final`, `Rodada N`, `Disputa de 3º lugar` |
| `DOUBLE_ELIM` | 2N−2 (+1 com reset) | `w-r1-m1`, `l-r1-m1`, `gf-1`, `gf-2` | `Chave superior · Rodada N`, `Semifinal/Final da chave superior`, `Chave inferior · Rodada N`, `Final da chave inferior`, `Grande Final`, `Grande Final (reset)` |
| `ROUND_ROBIN` | N·(N−1)/2 (×2 com `doubleRound`) | `rr-r1-m1` | `Rodada N` |
| `GROUPS` (duelos) | pontos corridos em cada grupo | `g1-r1-m1` | `Rodada N` |
| `GROUPS` (quedas) | 1 sala por grupo e queda | `g1-q1` | `Queda N` |
| `SWISS` | só a rodada 1 (as demais vêm de `generateSwissRound`) | `sw-r1-m1`, `sw-r1-bye` | `Rodada N` |
| `BATTLE_ROYALE` | 1 por sala e queda | `br-s1-q1` | `Queda N` |

Como ler a estrutura:

- **Byes (eliminatórias):** não existe partida de bye. Com 5 participantes saem 4 partidas; os seeds 1, 2 e 3 já aparecem na rodada 2, com `isBye: true` na vaga. `position` é a posição na árvore: os filhos da partida `p` da rodada `r` são `2p−1` e `2p` da rodada `r−1`, por isso a rodada 1 pode ter buracos (`w-r1-m2` sem `w-r1-m1`).
- **Vaga ainda sem dono:** `entrantId: null` com `source` dizendo de qual partida vem o vencedor ou o perdedor.
- **Bye do suíço:** partida com **uma vaga só** (`slots.length === 1`, `isBye: true`). Não recebe resultado e conta como vitória na tabela.
- **Folga em pontos corridos:** com número ímpar, quem não aparece na rodada está de folga.
- **Sala BR (`kind: 'LOBBY'`):** `slots` traz todas as equipes da sala; `dropIndex` e `multiplier` vêm preenchidos.
- **Grupos:** distribuição em serpentina pelos potes; tamanhos diferem em no máximo 1. Ids `g1`, `g2`…, nomes `Grupo A`, `Grupo B`… (depois do Z: `AA`, `AB`). Salas BR: `s1`, `Sala 1`.
- **`TEAM_VS_TEAM`:** a mesma árvore da eliminação simples, em MD1 a MD7.
- **`stopAtRemaining: 2`:** mata-mata que termina nas semifinais e entrega 2 finalistas para a fase seguinte.

Constantes e utilitários:

```ts
const STAGE_FORMATS: readonly StageFormat[];
const DEFAULT_LOBBY_SIZE = 12;
function seedEntrants(entrants: readonly Entrant[], seeding: SeedingMethod, seed: string): Entrant[];
function bracketOrder(size: number): number[];                       // bracketOrder(8) → [1, 8, 4, 5, 2, 7, 3, 6]
function snakeDistribute<T>(items: readonly T[], bucketCount: number): T[][];
function createPrng(seed: string): Prng;                              // { next(), int(max), shuffle(items) }
function randomSeed(): string;                                        // seed nova, não determinística
```

```ts
seedEntrants([{ id: 'a', rating: 900 }, { id: 'b', rating: 1500 }], 'RANKED', ''); // [{ id: 'b', seed: 1, … }, { id: 'a', seed: 2, … }]
snakeDistribute(['s1', 's2', 's3', 's4', 's5', 's6'], 2);                         // [['s1','s4','s5'], ['s2','s3','s6']]
createPrng('copa').shuffle([1, 2, 3]);                                             // sempre a mesma ordem para 'copa'
```

---

## 3. Operar a chave

### Tipos

```ts
interface ResultEntry {
  entrantId: string;
  score?: number;      // duelo: gols, coroas, frames ou jogos vencidos na série
  placement?: number;  // BR: colocação na queda
  kills?: number;      // BR: kills da equipe
  absent?: boolean;    // BR: não compareceu à queda
  stats?: Stats;       // estatísticas extras, repassadas às regras de pontuação
}

interface MatchResultInput {
  matchId: string;
  entries: ResultEntry[];
  winnerId?: string | null; // obrigatório quando o placar empata em mata-mata; null = empate
  walkover?: boolean;
}

interface MatchResult {
  matchId: string;
  entries: ResultEntry[];
  winnerId: string | null;
  loserId: string | null;
  draw: boolean;
  walkover: boolean;
  voided: boolean; // anulado (RN-06): não conta na tabela
}

type EntrantStatus = 'WITHDRAWN' | 'DISQUALIFIED';

interface StageState {
  results: Record<string, MatchResult>;
  entrantStatus: Record<string, EntrantStatus>; // ausente = ativo
  skipped: string[];                            // partidas ifNecessary que não serão jogadas
}

interface StageSnapshot { structure: StageStructure; state: StageState }
type MatchStatus = 'PENDING' | 'READY' | 'COMPLETED' | 'BYE' | 'SKIPPED' | 'VOIDED';
```

Guarde `structure` e `state` juntos: toda operação recebe os dois e devolve os dois novos.

### `createStageState`

```ts
function createStageState(): StageState; // { results: {}, entrantStatus: {}, skipped: [] }
```

### `applyResult`

```ts
function applyResult(structure: StageStructure, state: StageState, input: MatchResultInput): StageSnapshot;
```

```ts
let fase = { structure: chave, state: createStageState() };

// Duelo (MD3): o vencedor sai do placar e vai para a próxima partida
fase = applyResult(fase.structure, fase.state, {
  matchId: 'w-r1-m1',
  entries: [
    { entrantId: 'time-a', score: 2 },
    { entrantId: 'time-b', score: 1 },
  ],
});

// Queda de Battle Royale
fase = applyResult(fase.structure, fase.state, {
  matchId: 'br-s1-q1',
  entries: [
    { entrantId: 'alfa', placement: 1, kills: 7 },
    { entrantId: 'bravo', placement: 2, kills: 9 },
    { entrantId: 'charlie', absent: true },
  ],
});
```

Regras:

- **Duelo:** o vencedor vem de `winnerId` ou, na falta dele, do maior `score`. Pode mandar só `winnerId` (com `entries: []`).
- **Empate:** aceito apenas fora do mata-mata (`bracket === null`) e em jogo único. Em eliminatória lança `DRAW_NOT_ALLOWED`: mande `winnerId` com o vencedor do desempate (pênaltis vão em `stats`, RN-14). O motor não olha o modelo de pontuação; se o jogo não admite empate nos grupos, a tela barra antes.
- **Série (`bestOf > 1`):** quando há placar, o vencedor precisa ter exatamente as vitórias necessárias (2 na MD3, 3 na MD5…).
- **BR:** todas as equipes ativas da sala precisam estar em `entries`; colocações são inteiras, de 1 ao tamanho da sala, sem repetir. `kills` ausente vale 0. Quem não apareceu vai com `absent: true`.
- **Propagação:** preenche a vaga na `nextMatchId` (vencedor) e na `loserNextMatchId` (perdedor).
- **Reset da Grande Final:** se o campeão da chave de cima vence a `gf-1`, a `gf-2` entra em `state.skipped`; se perde, a `gf-2` recebe os dois.
- **Correção:** reaplicar em uma partida já concluída troca o resultado, desde que a partida seguinte ainda não tenha resultado (no suíço: desde que a próxima rodada não tenha sido gerada). Senão lança `RESULT_LOCKED`.

### `applyWalkover`

```ts
function applyWalkover(structure: StageStructure, state: StageState, input: { matchId: string; winnerId: string }): StageSnapshot;
```

```ts
fase = applyWalkover(fase.structure, fase.state, { matchId: 'w-r1-m2', winnerId: 'time-c' });
// resultado com walkover: true; placar 2×0 na MD3, 3×0 na MD5; em jogo único, config.walkoverScore × 0 (padrão 3×0)
```

Só para duelos. Em Battle Royale não existe W.O. da partida: a equipe ausente entra com `absent: true` (0 ponto e 0 kill, RN-04).

### `swapEntrants`

```ts
function swapEntrants(structure: StageStructure, entrantIdA: string, entrantIdB: string, state?: StageState): StageStructure;
```

```ts
// arrastar e soltar na prévia da chave
const ajustada = swapEntrants(chave, 'time-a', 'time-h', fase.state);
```

Troca os dois em todas as partidas, nos grupos e na ordem das seeds. Passando `state`, lança `STAGE_STARTED` se já houver resultado (a chave trava depois da primeira partida concluída, RN-07).

### `generateSwissRound`

```ts
function generateSwissRound(structure: StageStructure, state: StageState): StageStructure;
```

```ts
// depois de lançar todos os resultados da rodada atual
const comRodada2 = generateSwissRound(fase.structure, fase.state);
fase = { structure: comRodada2, state: fase.state };
```

Pareia por pontuação (vitória 1, empate 0,5, bye 1), sem repetir confronto. Com número ímpar, o bye vai para o pior colocado que ainda não folgou (nunca duas vezes para o mesmo). Quem desistiu ou foi desclassificado fica de fora. Lança `STAGE_INCOMPLETE` se a rodada atual não terminou, `INVALID_CONFIG` se todas as rodadas já foram geradas e `SWISS_PAIRING_IMPOSSIBLE` se não houver como parear sem revanche.

### `withdrawEntrant`

```ts
function withdrawEntrant(
  structure: StageStructure,
  state: StageState,
  input: { entrantId: string; kind: 'WITHDRAWN' | 'DISQUALIFIED' },
): StageSnapshot;
```

```ts
fase = withdrawEntrant(fase.structure, fase.state, { entrantId: 'time-b', kind: 'DISQUALIFIED' });
```

Aplica a RN-06 conforme o formato:

| Formato | Desistência (`WITHDRAWN`) | Desclassificação (`DISQUALIFIED`) |
|---|---|---|
| `SINGLE_ELIM`, `DOUBLE_ELIM`, `TEAM_VS_TEAM` | A partida atual e as futuras viram W.O. para o adversário, inclusive as que só ficarem prontas depois. Resultados passados ficam. | Igual. |
| `ROUND_ROBIN`, `GROUPS` (duelos) | Menos da metade dos jogos feitos: todos os resultados dele são anulados (`voided`). Metade ou mais: os restantes viram W.O. | Todos os resultados anulados. |
| `SWISS` | Sai dos próximos pareamentos; a partida pendente vira W.O. | Igual; a tabela zera os pontos. |
| `BATTLE_ROYALE`, `GROUPS` (quedas) | Deixa de ser exigido nas próximas quedas; os pontos feitos ficam. | A tabela zera os pontos e o manda para o fim. |

Motivo e auditoria ficam por conta de quem chama.

### `getMatchStatus`, `isStageComplete`, `isEliminationFormat`

```ts
function getMatchStatus(structure: StageStructure, state: StageState, matchId: string): MatchStatus;
function isStageComplete(structure: StageStructure, state: StageState): boolean;
function isEliminationFormat(format: string): boolean; // SINGLE_ELIM, DOUBLE_ELIM, TEAM_VS_TEAM
```

```ts
getMatchStatus(fase.structure, fase.state, 'w-r2-m1'); // 'PENDING' (falta participante) | 'READY' | 'COMPLETED' | 'BYE' | 'SKIPPED' | 'VOIDED'
isStageComplete(fase.structure, fase.state);           // true quando dá para avançar de fase
isEliminationFormat('GROUPS');                         // false
```

No suíço, `isStageComplete` só é `true` depois que todas as rodadas previstas foram geradas e concluídas.

---

## 4. Classificação e avanço

### Tipos

```ts
interface StandingsOptions {
  rules: Rule[];
  tiebreakers?: Tiebreaker[]; // padrão: DEFAULT_TIEBREAKERS
  scoreStat?: string;         // estatística que recebe o `score` do duelo: 'crowns', 'goals', 'frames'…
  drawSeed?: string;          // seed do sorteio de desempate (padrão: structure.seedUsed)
}

interface StandingRow {
  entrantId: string;
  name: string;
  groupId: string | null;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  booyahs: number;
  kills: number;
  scoreFor: number;      // BR: kills
  scoreAgainst: number;
  scoreDiff: number;
  avgPlacement: number | null;
  lastDropKills: number;
  status: 'ACTIVE' | 'WITHDRAWN' | 'DISQUALIFIED';
  eliminated: boolean;   // eliminatórias: já saiu da chave
  tiebreakNote: string | null;
}

interface Standings {
  format: StageFormat;
  groups: Array<{ groupId: string | null; name: string; rows: StandingRow[] }>;
  overall: StandingRow[]; // todos em uma tabela só
  drawSeed: string;
  drawUsed: boolean;      // true se algum empate foi a sorteio (registre na auditoria)
}

type QualificationRule =
  | { type: 'TOP_N_PER_GROUP'; n: number; repechage?: number }
  | { type: 'TOP_N_OVERALL'; n: number; repechage?: number }
  | { type: 'WINNERS'; repechage?: number };

interface QualifiedEntrant {
  entrantId: string;
  name: string;
  groupId: string | null;
  groupPosition: number;
  overallPosition: number;
  via: 'DIRECT' | 'REPECHAGE';
  seed: number; // seed na próxima fase
}

interface QualificationResult { qualified: QualifiedEntrant[]; eliminated: string[] }
```

### `computeStandings`

```ts
function computeStandings(structure: StageStructure, state: StageState, options: StandingsOptions): Standings;
const DEFAULT_TIEBREAKERS: readonly Tiebreaker[];
// ['points', 'wins', 'score', 'avgPlacement', 'headToHead', 'scoreDiff', 'lastDropKills', 'draw']
```

```ts
const ff = DEFAULT_SCORING_MODELS.find((m) => m.id === 'ff-br-padrao')!;
const tabela = computeStandings(fase.structure, fase.state, { rules: ff.rules, tiebreakers: ff.tiebreakers });

tabela.groups[0].rows[1];
// { entrantId: 'sq09', position: 2, points: 18, booyahs: 1, kills: 15, …,
//   tiebreakNote: 'Empate em pontos com Fúria Norte. Desempate por número de Booyahs (1).' }

// Clash Royale: o `score` do duelo são as coroas
const cr = DEFAULT_SCORING_MODELS.find((m) => m.id === 'cr-1v1')!;
computeStandings(fase.structure, fase.state, { rules: cr.rules, tiebreakers: cr.tiebreakers, scoreStat: 'crowns' });
```

Como a tabela é montada:

- Os pontos de cada participação saem de `computePoints`. Em duelos, as estatísticas são `{ outcome, score, ...entry.stats }` e, com `scoreStat`, o `score` também entra com aquele nome. Em BR são `{ kills, placement, ...entry.stats }`, com `matchIndex = dropIndex`, `matchCount` = quedas da sala e `multiplier` da queda.
- Os critérios são aplicados na ordem de `tiebreakers`. `points` é sempre o primeiro, mesmo se não vier na lista.

| Critério | O que compara |
|---|---|
| `points` | pontos totais |
| `wins` = `booyahs` | vitórias (Booyahs no BR) |
| `score` = `kills` | total a favor: kills no BR; gols, coroas, frames ou jogos vencidos nos duelos |
| `avgPlacement` | colocação média no BR (menor é melhor) |
| `headToHead` | pontos somados só nos jogos entre os empatados |
| `scoreDiff` | saldo (a favor − contra) |
| `lastDropKills` | kills na última queda jogada |
| `draw` | sorteio com `drawSeed`; reproduzível, e `drawUsed` avisa que aconteceu |

- `tiebreakNote` explica, em pt-BR, qual critério decidiu a posição de quem empatou em pontos. Se nenhum critério resolver e não houver `draw` na lista, fica a ordem das seeds, e a nota diz isso.
- Quem ainda não jogou não vai a sorteio: fica na ordem das seeds, sem nota.
- **W.O.** conta como vitória pelo placar do W.O. (RN-04). **Bye do suíço** conta como vitória.
- **Resultado anulado** (`voided`) não entra.
- **Desclassificado:** tudo zerado, `status: 'DISQUALIFIED'`, no fim da tabela (RN-05). **Desistente** mantém o que fez e aparece com `status: 'WITHDRAWN'`.
- **Eliminatórias:** quem foi mais longe fica à frente (campeão, vice, 3º…); os critérios só ordenam quem caiu na mesma rodada. `eliminated` diz quem já saiu.
- `groups` traz uma tabela por grupo ou sala; sem grupos, vem uma única entrada com `groupId: null`. `overall` junta todos.

### `applyQualification`

```ts
function applyQualification(standings: Standings, rule: QualificationRule): QualificationResult;
```

```ts
const { qualified, eliminated } = applyQualification(tabela, { type: 'TOP_N_PER_GROUP', n: 2 });
// qualified: os 1ºs de cada grupo (seeds 1…G), depois os 2ºs (seeds G+1…2G)

applyQualification(tabelaDoMataMata, { type: 'WINNERS', repechage: 2 });
// quem não foi eliminado + os 2 melhores eliminados (via: 'REPECHAGE')
```

- `TOP_N_PER_GROUP`: os N primeiros de cada grupo. `TOP_N_OVERALL`: os N primeiros da tabela geral.
- `WINNERS`: no mata-mata, quem não foi eliminado; nos outros formatos, o 1º de cada grupo.
- `repechage: n`: completa com os n melhores entre os que ficaram de fora. Padrão 0 (ADR-0001 Q3).
- Desistentes e desclassificados nunca se classificam.
- Dentro de cada nível (1ºs, 2ºs…), a ordem é a da tabela geral.

### `advanceStage`

```ts
function advanceStage(input: {
  structure: StageStructure;
  state: StageState;
  standings: StandingsOptions;
  qualification: QualificationRule;
  next: { format: StageFormat; config?: StageConfig; seeding?: SeedingMethod; seed?: string };
}): { standings: Standings; qualified: QualifiedEntrant[]; eliminated: string[]; next: StageStructure };
```

```ts
const previa = advanceStage({
  structure: fase.structure,
  state: fase.state,
  standings: { rules: ff.rules, tiebreakers: ff.tiebreakers },
  qualification: { type: 'TOP_N_PER_GROUP', n: 2 },
  next: { format: 'TEAM_VS_TEAM', config: { bestOf: 3, stopAtRemaining: 2 } },
});
previa.next; // StageStructure da próxima fase, para o organizador conferir e confirmar
```

- Lança `STAGE_INCOMPLETE` se faltar partida e `INVALID_QUALIFICATION` se a regra levar menos de 2.
- A próxima fase usa `seeding: 'RANKED'` pela classificação, a menos que `next.seeding` diga outra coisa.
- Em eliminatórias e no suíço, se a primeira rodada cruzar dois classificados do mesmo grupo, o de pior seed troca de lugar com o adversário de seed mais próxima que resolva o conflito. Quando não há troca possível (um grupo só), o confronto fica.
- É só uma prévia: nada é gravado. A tela pode ajustar com `swapEntrants` antes de confirmar.

---

## 5. Erros

```ts
class EngineError extends Error {
  readonly code: EngineErrorCode;
}

type EngineErrorCode =
  | 'INVALID_ENTRANTS' | 'INVALID_CONFIG' | 'MATCH_NOT_FOUND' | 'MATCH_NOT_READY'
  | 'INVALID_RESULT' | 'DRAW_NOT_ALLOWED' | 'RESULT_LOCKED' | 'STAGE_STARTED'
  | 'STAGE_INCOMPLETE' | 'ENTRANT_NOT_FOUND' | 'SWISS_PAIRING_IMPOSSIBLE' | 'INVALID_QUALIFICATION';
```

```ts
try {
  fase = applyResult(fase.structure, fase.state, entrada);
} catch (error) {
  if (error instanceof EngineError) mostrarAviso(error.message); // já em pt-BR
  else throw error;
}
```

---

## 6. Exemplo completo: Free Fire, grupos → mata-mata → final

```ts
const ff = DEFAULT_SCORING_MODELS.find((m) => m.id === 'ff-br-padrao')!;
const contra = DEFAULT_SCORING_MODELS.find((m) => m.id === 'ff-contra-squad')!;

// Fase 1: 48 squads em 4 grupos BR de 12, 3 quedas
let f1 = {
  structure: generateStage({
    format: 'GROUPS',
    entrants: squads,
    seeding: 'RANDOM',
    config: { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3 },
  }),
  state: createStageState(),
};
f1 = applyResult(f1.structure, f1.state, { matchId: 'g1-q1', entries: quedaDoGrupoA }); // …as 12 quedas

// Fase 2: top 2 de cada grupo, mata-mata MD3 até sobrarem 2
const paraMataMata = advanceStage({
  ...f1,
  standings: { rules: ff.rules, tiebreakers: ff.tiebreakers },
  qualification: { type: 'TOP_N_PER_GROUP', n: 2 },
  next: { format: 'TEAM_VS_TEAM', config: { bestOf: 3, stopAtRemaining: 2 } },
});
let f2 = { structure: paraMataMata.next, state: createStageState() };
// …applyResult nas quartas e nas semifinais

// Fase 3: os 2 finalistas + 2 da repescagem, 5 quedas, a última valendo ×2
const paraFinal = advanceStage({
  ...f2,
  standings: { rules: contra.rules, tiebreakers: contra.tiebreakers },
  qualification: { type: 'WINNERS', repechage: 2 },
  next: { format: 'BATTLE_ROYALE', config: { lobbySize: 4, drops: 5, dropMultipliers: [1, 1, 1, 1, 2] } },
});
let f3 = { structure: paraFinal.next, state: createStageState() };
// …applyResult nas 5 quedas

const campeao = computeStandings(f3.structure, f3.state, { rules: ff.rules, tiebreakers: ff.tiebreakers }).overall[0];
```

Esse roteiro, com dados fixos e o campeão conferido por soma direta, é o teste `test/ct06.test.ts` (fixture em `test/fixtures/ct06-ff-48-squads.ts`).

---

## Desenvolvimento

```bash
pnpm --filter @nova/engine lint
pnpm --filter @nova/engine typecheck
pnpm --filter @nova/engine test
pnpm --filter @nova/engine test:coverage   # limites: 90 / 90 / 90 / 85
```

- Código em `src/`, tudo exportado por `src/index.ts`. Testes em `test/**/*.test.ts`.
- Testes por propriedade com `fast-check` (`test/properties.test.ts`), de 2 a 1.024 participantes.
- `test/benchmark.test.ts` garante a meta do plano: chave de 1.024 participantes em menos de 200 ms.
- O pacote não pode importar nada de Node nem do navegador.
