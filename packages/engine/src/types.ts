/* Tipos públicos do motor. Tudo aqui é serializável em JSON. */

// ───────────────────────────── Pontuação ─────────────────────────────

/** Estatísticas brutas de uma participação (kills, placement, crowns, goals, outcome…). */
export type Stats = Record<string, number | string | undefined>;

export type Rule =
  | { type: 'PER_UNIT'; stat: string; points: number }
  | { type: 'TABLE'; stat: string; table: Record<string, number> }
  | { type: 'OUTCOME'; win: number; draw: number; loss: number }
  | { type: 'BONUS'; stat: string; op: 'gte' | 'lte' | 'eq'; value: number; points: number }
  | { type: 'CAP'; stat: string; max: number }
  | { type: 'MULTIPLIER'; factor: number; when?: { matchIndex?: number | 'last' } };

export type RuleType = Rule['type'];

export type MatchType = 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE';

/**
 * Critérios de desempate (PRD §10.6). `wins`/`booyahs` e `kills`/`score` são
 * sinônimos: o primeiro par conta vitórias (Booyahs no BR) e o segundo o total
 * a favor (kills no BR; gols, coroas, frames ou jogos vencidos nos duelos).
 */
export type Tiebreaker =
  | 'points'
  | 'wins'
  | 'booyahs'
  | 'kills'
  | 'score'
  | 'avgPlacement'
  | 'headToHead'
  | 'scoreDiff'
  | 'lastDropKills'
  | 'draw';

export interface ScoringModel {
  id: string;
  name: string;
  gameSlug: string;
  matchType: MatchType;
  rules: Rule[];
  tiebreakers: Tiebreaker[];
  isDefault?: boolean;
}

export interface ScoringContext {
  /** Número da partida/queda, começando em 1. */
  matchIndex?: number;
  /** Total de partidas/quedas (para `when.matchIndex = 'last'`). */
  matchCount?: number;
  /** Multiplicador extra da partida (ex.: `MatchNode.multiplier`). */
  multiplier?: number;
}

export interface PointsBreakdownItem {
  /** Índice da regra em `rules`; -1 para o multiplicador vindo do contexto. */
  ruleIndex: number;
  type: RuleType;
  stat?: string;
  /** Pontos que esta regra somou (ou tirou, no caso de CAP) ao total. */
  points: number;
  /** Texto em pt-BR para exibir na prévia. */
  label: string;
}

export interface PointsResult {
  total: number;
  breakdown: PointsBreakdownItem[];
}

// ───────────────────────────── Chaveamento ─────────────────────────────

export type StageFormat =
  | 'SINGLE_ELIM'
  | 'DOUBLE_ELIM'
  | 'GROUPS'
  | 'ROUND_ROBIN'
  | 'SWISS'
  | 'BATTLE_ROYALE'
  | 'TEAM_VS_TEAM';

export type SeedingMethod = 'RANDOM' | 'RANKED' | 'MANUAL';

export interface Entrant {
  id: string;
  name?: string;
  /** Cabeça de chave (1 = melhor). Na estrutura gerada é sempre preenchido. */
  seed?: number;
  /** Ranking/MMR: maior = melhor. Usado no seeding `RANKED` quando não há `seed`. */
  rating?: number;
}

export interface MatchSlot {
  entrantId: string | null;
  /** De onde vem o ocupante quando ainda não é conhecido. */
  source?: { matchId: string; outcome: 'winner' | 'loser' };
  /** O ocupante desta vaga recebeu bye (folga) para chegar aqui. */
  isBye?: boolean;
}

export type BracketSide = 'WINNERS' | 'LOSERS' | 'FINAL' | 'THIRD_PLACE';

export interface MatchNode {
  id: string;
  round: number;
  /** Posição na rodada (1 = topo). Na chave de vencedores é a posição na árvore. */
  position: number;
  bracket: BracketSide | null;
  groupId: string | null;
  kind: 'DUEL' | 'LOBBY';
  slots: MatchSlot[];
  bestOf: number;
  nextMatchId: string | null;
  loserNextMatchId: string | null;
  /** Número da queda (BR), começando em 1. */
  dropIndex?: number;
  multiplier?: number;
  /** Partida que só acontece se for necessária (reset da Grande Final). */
  ifNecessary?: boolean;
  /** pt-BR: 'Final', 'Semifinal', 'Quartas de final', 'Rodada 2', 'Queda 3'… */
  roundLabel: string;
}

export interface StageGroup {
  id: string;
  name: string;
  entrantIds: string[];
}

export interface StageConfig {
  /** Melhor de N nos duelos: 1, 3, 5 ou 7. Padrão 1. */
  bestOf?: number;
  /** Disputa de 3º lugar (SINGLE_ELIM / TEAM_VS_TEAM). Padrão false. */
  thirdPlace?: boolean;
  /**
   * Para a chave quando restarem tantos participantes (potência de 2).
   * Padrão 1 (joga até a final). Ex.: 2 = mata-mata até sobrarem 2 finalistas.
   */
  stopAtRemaining?: number;
  /** Reset da Grande Final (DOUBLE_ELIM). Padrão true. */
  grandFinalReset?: boolean;
  /** Número de grupos (GROUPS). */
  groupCount?: number;
  /** Alternativa a `groupCount`: tamanho máximo de cada grupo. */
  groupSize?: number;
  /** Dentro do grupo: duelos em pontos corridos ou quedas BR. Padrão 'ROUND_ROBIN'. */
  groupMode?: 'ROUND_ROBIN' | 'BATTLE_ROYALE';
  /** Turno e returno (ROUND_ROBIN / GROUPS). Padrão false. */
  doubleRound?: boolean;
  /** Número de rodadas do suíço. Padrão ceil(log2 N). */
  rounds?: number;
  /** Tamanho máximo da sala BR. Padrão 12 (ADR-0001 Q1). */
  lobbySize?: number;
  /** Quedas por sala/grupo BR. Padrão 1. */
  drops?: number;
  /** Multiplicador por queda (índice 0 = queda 1). Ausente = 1. */
  dropMultipliers?: number[];
  /** Kills lançadas por jogador (ADR-0001 Q6). Só repassado; o motor não usa. */
  killsPerPlayer?: boolean;
  /** Placar do vencedor em um W.O. de jogo único (RN-04). Padrão 3. */
  walkoverScore?: number;
}

export interface StageStructure {
  format: StageFormat;
  /** Seed do sorteio (registrada para auditoria; mesma seed = mesma chave). */
  seedUsed: string;
  seeding: SeedingMethod;
  /** Configuração com os padrões já aplicados. */
  config: StageConfig;
  /** Participantes na ordem das seeds (índice 0 = seed 1). */
  entrants: Entrant[];
  /** Grupos (GROUPS) ou salas (BATTLE_ROYALE). Vazio nos outros formatos. */
  groups: StageGroup[];
  matches: MatchNode[];
  /** Rodadas previstas (na eliminação dupla: rodadas da chave de vencedores). */
  rounds: number;
}

export interface GenerateStageInput {
  format: StageFormat;
  entrants: Entrant[];
  config?: StageConfig;
  seeding: SeedingMethod;
  seed?: string;
}

// ───────────────────────────── Resultados ─────────────────────────────

export interface ResultEntry {
  entrantId: string;
  /** Duelo: gols, coroas, frames ou jogos vencidos na série. */
  score?: number;
  /** BR: colocação na queda (1 = Booyah). */
  placement?: number;
  /** BR: kills da equipe na queda. */
  kills?: number;
  /** BR: não compareceu à queda (0 ponto, 0 kill). */
  absent?: boolean;
  /** Estatísticas brutas extras, repassadas às regras de pontuação. */
  stats?: Stats;
}

export interface MatchResultInput {
  matchId: string;
  entries: ResultEntry[];
  /** Vencedor explícito (obrigatório quando o placar empata em mata-mata). `null` = empate. */
  winnerId?: string | null;
  walkover?: boolean;
}

export interface MatchResult {
  matchId: string;
  entries: ResultEntry[];
  winnerId: string | null;
  loserId: string | null;
  draw: boolean;
  walkover: boolean;
  /** Resultado anulado (RN-06): não conta na tabela. */
  voided: boolean;
}

export type EntrantStatus = 'WITHDRAWN' | 'DISQUALIFIED';

export interface StageState {
  results: Record<string, MatchResult>;
  /** Quem desistiu ou foi desclassificado. Ausente = ativo. */
  entrantStatus: Record<string, EntrantStatus>;
  /** Partidas `ifNecessary` que não serão jogadas. */
  skipped: string[];
}

export interface StageSnapshot {
  structure: StageStructure;
  state: StageState;
}

export type MatchStatus = 'PENDING' | 'READY' | 'COMPLETED' | 'BYE' | 'SKIPPED' | 'VOIDED';

// ───────────────────────────── Classificação ─────────────────────────────

export interface StandingsOptions {
  rules: Rule[];
  /** Ordem dos critérios. `points` é sempre o primeiro, mesmo se omitido. */
  tiebreakers?: Tiebreaker[];
  /** Nome da estatística que recebe o `score` do duelo (ex.: 'crowns', 'goals', 'frames'). */
  scoreStat?: string;
  /** Seed do sorteio de desempate. Padrão: `structure.seedUsed`. */
  drawSeed?: string;
}

export interface StandingRow {
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
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  avgPlacement: number | null;
  lastDropKills: number;
  status: 'ACTIVE' | EntrantStatus;
  /** Formatos eliminatórios: já foi eliminado da chave. */
  eliminated: boolean;
  /** Explicação em pt-BR quando a posição foi decidida por desempate. */
  tiebreakNote: string | null;
}

export interface Standings {
  format: StageFormat;
  groups: Array<{ groupId: string | null; name: string; rows: StandingRow[] }>;
  /** Todos os participantes em uma única tabela. */
  overall: StandingRow[];
  /** Seed usada quando algum empate foi a sorteio. */
  drawSeed: string;
  drawUsed: boolean;
}

export type QualificationRule =
  | { type: 'TOP_N_PER_GROUP'; n: number; repechage?: number }
  | { type: 'TOP_N_OVERALL'; n: number; repechage?: number }
  | { type: 'WINNERS'; repechage?: number };

export interface QualifiedEntrant {
  entrantId: string;
  name: string;
  groupId: string | null;
  groupPosition: number;
  overallPosition: number;
  via: 'DIRECT' | 'REPECHAGE';
  /** Seed para a próxima fase (1 = melhor classificado). */
  seed: number;
}

export interface QualificationResult {
  qualified: QualifiedEntrant[];
  eliminated: string[];
}

export interface AdvanceStageInput {
  structure: StageStructure;
  state: StageState;
  standings: StandingsOptions;
  qualification: QualificationRule;
  next: { format: StageFormat; config?: StageConfig; seeding?: SeedingMethod; seed?: string };
}

export interface StagePreview {
  standings: Standings;
  qualified: QualifiedEntrant[];
  eliminated: string[];
  /** Prévia da próxima fase (o organizador confirma antes de valer). */
  next: StageStructure;
}
