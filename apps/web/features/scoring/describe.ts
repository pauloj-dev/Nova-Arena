/**
 * Texto em pt-BR que explica regras e modelos de pontuação, e os exemplos padrão de cada tipo de partida.
 * Funções puras: servem ao editor, aos cartões do Admin e às páginas públicas de jogos.
 * Nenhuma conta de pontos é feita aqui — isso é sempre do motor (`./preview`).
 */
import type { ExtraStatField, MatchType, ScoringRule } from '@nova/schemas';
import { getFormat, getT } from '@/shared/i18n/core';
import { messages } from './messages';
import type { RuleType } from './types';

const text = () => getT(messages, 'describe');

/**
 * Mapa de rótulos lido do arquivo de mensagens na hora do uso (issue 108): cada valor é um getter, então o texto
 * acompanha o idioma e nada é traduzido ao carregar o módulo.
 */
function labelRecord<K extends string, V>(keys: readonly K[], read: (key: K) => V): Record<K, V> {
  const record = {} as Record<K, V>;
  for (const key of keys) Object.defineProperty(record, key, { get: () => read(key), enumerable: true });
  return record;
}

const MATCH_TYPES: readonly MatchType[] = ['DUEL', 'TEAM_VS_TEAM', 'BATTLE_ROYALE'];

export const MATCH_TYPE_LABELS: Record<MatchType, string> = labelRecord(MATCH_TYPES, (type) => text()(`tipoDePartida.${type}`));

export const MATCH_TYPE_OPTIONS = MATCH_TYPES.map((value) => ({
  value,
  get label() {
    return MATCH_TYPE_LABELS[value];
  },
}));

export const RULE_TYPES: RuleType[] = ['PER_UNIT', 'TABLE', 'OUTCOME', 'BONUS', 'CAP', 'MULTIPLIER'];

/** Nome e explicação curta de cada tipo de regra (PRD §11.3). */
export const RULE_TYPE_INFO: Record<RuleType, { label: string; hint: string }> = labelRecord(RULE_TYPES, (type) => ({
  label: text()(`tipoDeRegra.${type}.rotulo`),
  hint: text()(`tipoDeRegra.${type}.dica`),
}));

export type Outcome = 'win' | 'draw' | 'loss';
const OUTCOMES: readonly Outcome[] = ['win', 'draw', 'loss'];
export const OUTCOME_LABELS: Record<Outcome, string> = labelRecord(OUTCOMES, (outcome) => text()(`resultado.${outcome}`));
export const OUTCOME_OPTIONS = OUTCOMES.map((value) => ({
  value,
  get label() {
    return OUTCOME_LABELS[value];
  },
}));

export type BonusOp = 'gte' | 'lte' | 'eq';
export const BONUS_OP_LABELS: Record<BonusOp, string> = labelRecord<BonusOp, string>(['gte', 'lte', 'eq'], (op) => text()(`condicaoBonus.${op}`));

/** "queda" no Battle Royale, "partida" nos outros tipos (o `select` das mensagens). */
function matchKind(matchType: MatchType | undefined): 'br' | 'outro' {
  return matchType === 'BATTLE_ROYALE' ? 'br' : 'outro';
}

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
  return getFormat().number(value, { maximumFractionDigits: 3 });
}
/** "1 ponto", "3 pontos", "1,5 ponto". */
export function pointsText(value: number): string {
  return text()('pontos', { valor: formatNumber(value), n: Math.abs(value) });
}
/** Forma curta para totais: "10 pts", "1 pt". */
export function pts(value: number): string {
  return text()('pts', { valor: formatNumber(value), n: Math.abs(value) });
}
/** Com sinal, para parcelas: "+7", "−3", "0". */
export function signed(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value))}`;
  return '0';
}
export function ordinal(value: number | string): string {
  return text()('ordinal', { valor: String(value) });
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
const SCORE_LABEL_BY_GAME: Record<string, 'clashRoyale' | 'efootball' | 'eightBallPool' | 'freeFire'> = {
  'clash-royale': 'clashRoyale',
  efootball: 'efootball',
  '8-ball-pool': 'eightBallPool',
  'free-fire': 'freeFire',
};

/** Como o placar se chama em um jogo conhecido; `undefined` quando não sabemos (o texto usa "placar"). */
export function scoreLabelForGame(gameSlug: string | null | undefined): string | undefined {
  const key = gameSlug ? SCORE_LABEL_BY_GAME[gameSlug] : undefined;
  return key ? text()(`placarDoJogo.${key}`) : undefined;
}

type BaseStat = 'placar' | 'kills' | 'colocacao' | 'resultado';
function baseStat(key: string, stat: BaseStat, kind: StatInfo['kind']): StatInfo {
  const t = text();
  return { key, label: t(`estatistica.${stat}.rotulo`), one: t(`estatistica.${stat}.um`), many: t(`estatistica.${stat}.varios`), kind };
}

function scoreInfo(scoreLabel?: string): StatInfo {
  const many = scoreLabel?.trim().toLowerCase();
  if (!many) return baseStat('score', 'placar', 'number');
  return { key: 'score', label: capitalize(many), one: many.endsWith('s') ? many.slice(0, -1) : many, many, kind: 'number' };
}

/** Rótulo e unidades de uma estatística. Chave desconhecida aparece como foi cadastrada. */
export function statInfo(key: string, opts: DescribeOptions = {}): StatInfo {
  if (key === 'kills') return baseStat(key, 'kills', 'number');
  if (key === 'placement') return baseStat(key, 'colocacao', 'placement');
  if (key === 'score') return scoreInfo(opts.scoreLabel);
  if (key === 'outcome') return baseStat(key, 'resultado', 'outcome');
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
  const t = text();
  const entries = sortedTable(rule.table);
  if (entries.length === 0) return t('tabelaVazia', { estatistica: stat.many });
  if (stat.kind === 'placement') {
    const [first] = entries;
    if (entries.length === 1 && first && first[0] === '1') return t('tabelaBooyah', { pontos: pointsText(first[1]) });
    return t('tabelaColocacao', { lista: entries.map(([key, value]) => `${ordinal(key)} = ${formatNumber(value)}`).join(', ') });
  }
  return t('tabelaEstatistica', { estatistica: stat.many, lista: entries.map(([key, value]) => `${key} = ${formatNumber(value)}`).join(', ') });
}

function describeBonus(rule: Extract<ScoringRule, { type: 'BONUS' }>, stat: StatInfo): string {
  const t = text();
  const ganho = t('bonusGanho', { sinal: signed(rule.points), n: Math.abs(rule.points) });
  const value = formatNumber(rule.value);
  if (stat.kind === 'placement') {
    const colocacao = ordinal(value);
    if (rule.op === 'lte') return t('bonusAteColocacao', { ganho, colocacao });
    if (rule.op === 'gte') return t('bonusDaColocacaoParaBaixo', { ganho, colocacao });
    return t('bonusNaColocacao', { ganho, colocacao });
  }
  const unidade = rule.value === 1 ? stat.one : stat.many;
  if (rule.op === 'gte') return t('bonusOuMais', { ganho, valor: value, unidade });
  if (rule.op === 'lte') return t('bonusOuMenos', { ganho, valor: value, unidade });
  return t('bonusExatamente', { ganho, valor: value, unidade });
}

function describeMultiplier(rule: Extract<ScoringRule, { type: 'MULTIPLIER' }>, opts: DescribeOptions): string {
  const t = text();
  const fator = `×${formatNumber(rule.factor)}`;
  const target = rule.when?.matchIndex;
  const tipo = matchKind(opts.matchType);
  if (target === undefined) return t('multiplicadorTodas', { tipo, fator });
  if (target === 'last') return t('multiplicadorUltima', { tipo, fator });
  return t('multiplicadorUma', { numero: String(target), tipo, fator });
}

/** Uma regra em português claro: "1 ponto por kill", "Booyah (1º lugar) vale 3 pontos". */
export function describeRule(rule: ScoringRule, opts: DescribeOptions = {}): string {
  switch (rule.type) {
    case 'PER_UNIT':
      return text()('porUnidade', { pontos: pointsText(rule.points), unidade: statInfo(rule.stat, opts).one });
    case 'TABLE':
      return describeTable(rule, statInfo(rule.stat, opts));
    case 'OUTCOME':
      return text()('resultadoDaPartida', { pontos: pointsText(rule.win), empate: formatNumber(rule.draw), derrota: formatNumber(rule.loss) });
    case 'BONUS':
      return describeBonus(rule, statInfo(rule.stat, opts));
    case 'CAP':
      return text()('limite', { pontos: pointsText(rule.max), estatistica: statInfo(rule.stat, opts).many, tipo: matchKind(opts.matchType) });
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
  if (stat.kind === 'placement') return text()('valorColocacao', { colocacao: ordinal(value) });
  const amount = Number(value);
  return `${Number.isFinite(amount) ? formatNumber(amount) : value} ${amount === 1 ? stat.one : stat.many}`;
}

/** O exemplo por extenso: "7 kills + 1º lugar", "2 coroas + vitória (queda 3 de 3)". */
export function describeExample(fields: readonly StatInfo[], stats: ExampleStats, opts: DescribeOptions = {}, ctx: ExampleContext | null = null): string {
  const parts = fields.map((field) => describeStatValue(field, stats[field.key])).filter((part): part is string => part !== null);
  const exemplo = parts.join(' + ');
  if (!ctx) return exemplo;
  return text()('exemploNaPartida', { exemplo, tipo: matchKind(opts.matchType), numero: ctx.matchIndex, total: ctx.matchCount });
}
