/**
 * Texto em pt-BR que explica regras e modelos de pontuação, e os exemplos padrão de cada tipo de partida.
 * Funções puras: servem ao editor, aos cartões do Admin e às páginas públicas de jogos.
 * Nenhuma conta de pontos é feita aqui — isso é sempre do motor (`./preview`).
 */
import type { ExtraStatField, MatchType, ScoringRule } from '@nova/schemas';
import type { RuleType } from './types';

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  DUEL: 'Duelo',
  TEAM_VS_TEAM: 'Equipe x Equipe',
  BATTLE_ROYALE: 'Battle Royale',
};

export const MATCH_TYPE_OPTIONS = (Object.keys(MATCH_TYPE_LABELS) as MatchType[]).map((value) => ({ value, label: MATCH_TYPE_LABELS[value] }));

export const RULE_TYPES: RuleType[] = ['PER_UNIT', 'TABLE', 'OUTCOME', 'BONUS', 'CAP', 'MULTIPLIER'];

/** Nome e explicação curta de cada tipo de regra (PRD §11.3). */
export const RULE_TYPE_INFO: Record<RuleType, { label: string; hint: string }> = {
  PER_UNIT: { label: 'Pontos por unidade', hint: 'Cada unidade da estatística vale pontos. Ex.: 1 ponto por kill.' },
  TABLE: { label: 'Tabela de pontos', hint: 'Cada valor da estatística tem uma pontuação. Ex.: Booyah (1º lugar) vale 3.' },
  OUTCOME: { label: 'Resultado da partida', hint: 'Pontos por vitória, empate e derrota. Ex.: 3 / 1 / 0.' },
  BONUS: { label: 'Bônus', hint: 'Pontos extras quando uma condição é atingida. Ex.: +2 com 10 kills ou mais.' },
  CAP: { label: 'Limite', hint: 'Teto de pontos vindos de uma estatística. Ex.: no máximo 15 pontos de kill por queda.' },
  MULTIPLIER: { label: 'Multiplicador', hint: 'Multiplica os pontos da partida. Ex.: a última queda vale ×2.' },
};

export const OUTCOME_LABELS = { win: 'Vitória', draw: 'Empate', loss: 'Derrota' } as const;
export type Outcome = keyof typeof OUTCOME_LABELS;
export const OUTCOME_OPTIONS = (Object.keys(OUTCOME_LABELS) as Outcome[]).map((value) => ({ value, label: OUTCOME_LABELS[value] }));

export const BONUS_OP_LABELS = { gte: 'ou mais (≥)', lte: 'ou menos (≤)', eq: 'exatamente (=)' } as const;

export interface DescribeOptions {
  /** Tipo de partida: decide entre "queda" (Battle Royale) e "partida". */
  matchType?: MatchType;
  /** Estatísticas extras do jogo (ex.: pênaltis), para mostrar o rótulo em vez da chave. */
  extraStats?: ExtraStatField[];
  /** Como o placar (`score`) se chama neste jogo, no plural: "coroas", "gols", "frames". Sem isso, vira "placar". */
  scoreLabel?: string;
}

// ── Números ──────────────────────────────────────────────────────────
export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
/** "1 ponto", "3 pontos", "1,5 ponto". */
export function pointsText(value: number): string {
  return `${formatNumber(value)} ${Math.abs(value) === 1 ? 'ponto' : 'pontos'}`;
}
/** Forma curta para totais: "10 pts", "1 pt". */
export function pts(value: number): string {
  return `${formatNumber(value)} ${Math.abs(value) === 1 ? 'pt' : 'pts'}`;
}
/** Com sinal, para parcelas: "+7", "−3", "0". */
export function signed(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value))}`;
  return '0';
}
export function ordinal(value: number | string): string {
  return `${value}º`;
}

// ── Estatísticas ─────────────────────────────────────────────────────
export interface StatInfo {
  key: string;
  /** Rótulo de campo: "Kills", "Colocação", "Coroas". */
  label: string;
  /** Uma unidade, em minúsculas: "kill", "coroa". */
  one: string;
  /** Várias unidades, em minúsculas: "kills", "coroas". */
  many: string;
  kind: 'number' | 'placement' | 'outcome';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Jogos do lançamento (PRD §10.1). Para qualquer outro jogo o placar fica com o rótulo genérico. */
const SCORE_LABEL_BY_GAME: Record<string, string> = {
  'clash-royale': 'coroas',
  efootball: 'gols',
  '8-ball-pool': 'frames',
  'free-fire': 'rounds',
};

/** Como o placar se chama em um jogo conhecido; `undefined` quando não sabemos (o texto usa "placar"). */
export function scoreLabelForGame(gameSlug: string | null | undefined): string | undefined {
  return gameSlug ? SCORE_LABEL_BY_GAME[gameSlug] : undefined;
}

function scoreInfo(scoreLabel?: string): StatInfo {
  const many = scoreLabel?.trim().toLowerCase();
  if (!many) return { key: 'score', label: 'Placar', one: 'ponto de placar', many: 'pontos de placar', kind: 'number' };
  return { key: 'score', label: capitalize(many), one: many.endsWith('s') ? many.slice(0, -1) : many, many, kind: 'number' };
}

/** Rótulo e unidades de uma estatística. Chave desconhecida aparece como foi cadastrada. */
export function statInfo(key: string, opts: DescribeOptions = {}): StatInfo {
  if (key === 'kills') return { key, label: 'Kills', one: 'kill', many: 'kills', kind: 'number' };
  if (key === 'placement') return { key, label: 'Colocação', one: 'colocação', many: 'colocação', kind: 'placement' };
  if (key === 'score') return scoreInfo(opts.scoreLabel);
  if (key === 'outcome') return { key, label: 'Resultado', one: 'resultado', many: 'resultado', kind: 'outcome' };
  const extra = opts.extraStats?.find((s) => s.key === key);
  const label = extra?.label ?? key;
  return { key, label, one: label.toLowerCase(), many: label.toLowerCase(), kind: 'number' };
}

/**
 * Estatísticas oferecidas para cada tipo de partida: Battle Royale → kills e colocação;
 * duelo e equipe x equipe → placar e resultado; mais as estatísticas extras do jogo.
 */
export function statOptions(matchType: MatchType, opts: DescribeOptions = {}): StatInfo[] {
  const base = matchType === 'BATTLE_ROYALE' ? ['kills', 'placement'] : ['score', 'outcome'];
  const extras = (opts.extraStats ?? []).map((s) => s.key).filter((key) => !base.includes(key));
  return [...base, ...extras].map((key) => statInfo(key, opts));
}

/** As que podem entrar em regra com estatística (o resultado tem a regra própria, `OUTCOME`). */
export function ruleStatOptions(matchType: MatchType, opts: DescribeOptions = {}): StatInfo[] {
  return statOptions(matchType, opts).filter((s) => s.kind !== 'outcome');
}

// ── Regras ───────────────────────────────────────────────────────────
function sortedTable(table: Record<string, number>): Array<[string, number]> {
  return Object.entries(table).sort(([a], [b]) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b, 'pt-BR');
  });
}

function describeTable(rule: Extract<ScoringRule, { type: 'TABLE' }>, stat: StatInfo): string {
  const entries = sortedTable(rule.table);
  if (entries.length === 0) return `Tabela de ${stat.many} ainda sem valores`;
  if (stat.kind === 'placement') {
    const [first] = entries;
    if (entries.length === 1 && first && first[0] === '1') return `Booyah (1º lugar) vale ${pointsText(first[1])}`;
    return `Pontos por colocação: ${entries.map(([key, value]) => `${ordinal(key)} = ${formatNumber(value)}`).join(', ')}`;
  }
  return `Pontos por ${stat.many}: ${entries.map(([key, value]) => `${key} = ${formatNumber(value)}`).join(', ')}`;
}

function describeBonus(rule: Extract<ScoringRule, { type: 'BONUS' }>, stat: StatInfo): string {
  const gain = `${signed(rule.points)} ${Math.abs(rule.points) === 1 ? 'ponto' : 'pontos'}`;
  const value = formatNumber(rule.value);
  if (stat.kind === 'placement') {
    if (rule.op === 'lte') return `${gain} para quem ficar até o ${ordinal(value)} lugar`;
    if (rule.op === 'gte') return `${gain} para quem ficar do ${ordinal(value)} lugar para baixo`;
    return `${gain} para o ${ordinal(value)} lugar`;
  }
  const unit = rule.value === 1 ? stat.one : stat.many;
  if (rule.op === 'gte') return `${gain} com ${value} ${unit} ou mais`;
  if (rule.op === 'lte') return `${gain} com ${value} ${unit} ou menos`;
  return `${gain} com exatamente ${value} ${unit}`;
}

function describeMultiplier(rule: Extract<ScoringRule, { type: 'MULTIPLIER' }>, opts: DescribeOptions): string {
  const factor = `×${formatNumber(rule.factor)}`;
  const target = rule.when?.matchIndex;
  const br = opts.matchType === 'BATTLE_ROYALE';
  if (target === undefined) return `Todos os pontos da ${br ? 'queda' : 'partida'} valem ${factor}`;
  if (target === 'last') return `A última ${br ? 'queda' : 'partida'} vale ${factor}`;
  return `A ${target}ª ${br ? 'queda' : 'partida'} vale ${factor}`;
}

/** Uma regra em português claro: "1 ponto por kill", "Booyah (1º lugar) vale 3 pontos". */
export function describeRule(rule: ScoringRule, opts: DescribeOptions = {}): string {
  switch (rule.type) {
    case 'PER_UNIT':
      return `${pointsText(rule.points)} por ${statInfo(rule.stat, opts).one}`;
    case 'TABLE':
      return describeTable(rule, statInfo(rule.stat, opts));
    case 'OUTCOME':
      return `Vitória vale ${pointsText(rule.win)}, empate ${formatNumber(rule.draw)} e derrota ${formatNumber(rule.loss)}`;
    case 'BONUS':
      return describeBonus(rule, statInfo(rule.stat, opts));
    case 'CAP':
      return `No máximo ${pointsText(rule.max)} de ${statInfo(rule.stat, opts).many} por ${opts.matchType === 'BATTLE_ROYALE' ? 'queda' : 'partida'}`;
    case 'MULTIPLIER':
      return describeMultiplier(rule, opts);
  }
}

/** O modelo inteiro, uma frase por regra, na ordem em que foram cadastradas. */
export function describeModel(rules: readonly ScoringRule[], opts: DescribeOptions = {}): string[] {
  return rules.map((rule) => describeRule(rule, opts));
}

// ── Exemplos ─────────────────────────────────────────────────────────
export type ExampleStats = Record<string, number | string>;
export interface ExampleContext {
  matchIndex: number;
  matchCount: number;
}

const EXAMPLE_VALUES: ExampleStats = { kills: 7, placement: 1, score: 2, outcome: 'win' };

/** Exemplo padrão de cada tipo de partida: BR → 7 kills e 1º lugar; duelo e equipe → placar 2 e vitória. */
export function defaultExample(matchType: MatchType): ExampleStats {
  return matchType === 'BATTLE_ROYALE' ? { kills: 7, placement: 1 } : { score: 2, outcome: 'win' };
}

/** Estatísticas que as regras usam, na ordem em que aparecem. */
export function statsUsedByRules(rules: readonly ScoringRule[]): string[] {
  const used: string[] = [];
  for (const rule of rules) {
    const key = rule.type === 'OUTCOME' ? 'outcome' : 'stat' in rule ? rule.stat : undefined;
    if (key && !used.includes(key)) used.push(key);
  }
  return used;
}

/** Campos do exemplo: os do tipo de partida e, depois, qualquer outra estatística que as regras usem. */
export function exampleFields(rules: readonly ScoringRule[], matchType: MatchType, opts: DescribeOptions = {}): StatInfo[] {
  const base = Object.keys(defaultExample(matchType));
  const others = statsUsedByRules(rules).filter((key) => !base.includes(key));
  return [...base, ...others].map((key) => statInfo(key, opts));
}

/** Valores iniciais do exemplo para um conjunto de regras. */
export function exampleStats(rules: readonly ScoringRule[], matchType: MatchType): ExampleStats {
  const stats: ExampleStats = { ...defaultExample(matchType) };
  for (const key of statsUsedByRules(rules)) {
    if (stats[key] === undefined) stats[key] = EXAMPLE_VALUES[key] ?? 2;
  }
  return stats;
}

/**
 * Em que partida o exemplo acontece. Só existe quando algum multiplicador vale para uma
 * partida específica — e o exemplo é justamente essa partida, para o multiplicador aparecer.
 */
export function exampleContext(rules: readonly ScoringRule[]): ExampleContext | null {
  for (const rule of rules) {
    if (rule.type !== 'MULTIPLIER') continue;
    const target = rule.when?.matchIndex;
    if (target === 'last') return { matchIndex: 3, matchCount: 3 };
    if (typeof target === 'number') return { matchIndex: Math.max(1, target), matchCount: Math.max(3, target) };
  }
  return null;
}

function describeStatValue(stat: StatInfo, value: number | string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (stat.kind === 'outcome') return OUTCOME_LABELS[value as Outcome]?.toLowerCase() ?? null;
  if (stat.kind === 'placement') return `${ordinal(value)} lugar`;
  const amount = Number(value);
  return `${Number.isFinite(amount) ? formatNumber(amount) : value} ${amount === 1 ? stat.one : stat.many}`;
}

/** O exemplo por extenso: "7 kills + 1º lugar", "2 coroas + vitória (queda 3 de 3)". */
export function describeExample(fields: readonly StatInfo[], stats: ExampleStats, opts: DescribeOptions = {}, ctx: ExampleContext | null = null): string {
  const parts = fields.map((field) => describeStatValue(field, stats[field.key])).filter((part): part is string => part !== null);
  const text = parts.join(' + ');
  if (!ctx) return text;
  return `${text} (${opts.matchType === 'BATTLE_ROYALE' ? 'queda' : 'partida'} ${ctx.matchIndex} de ${ctx.matchCount})`;
}
