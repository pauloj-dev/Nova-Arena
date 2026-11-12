import type {
  PointsBreakdownItem,
  PointsResult,
  Rule,
  ScoringContext,
  ScoringModel,
  Stats,
  Tiebreaker,
} from './types';

/** Arredonda para tirar o ruído de ponto flutuante (0.1 × 3 = 0.3). */
export function roundPoints(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function toNumber(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

const pts = (n: number): string => `${n} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;

const OUTCOME_LABEL: Record<string, string> = { win: 'Vitória', draw: 'Empate', loss: 'Derrota' };
const OP_SYMBOL = { gte: '≥', lte: '≤', eq: '=' } as const;

function multiplierApplies(rule: Extract<Rule, { type: 'MULTIPLIER' }>, ctx: ScoringContext): boolean {
  const target = rule.when?.matchIndex;
  if (target === undefined) return true;
  if (ctx.matchIndex === undefined) return false;
  if (target === 'last') return ctx.matchCount !== undefined && ctx.matchIndex === ctx.matchCount;
  return ctx.matchIndex === target;
}

/**
 * Transforma estatísticas brutas em pontos (RN-01: os pontos nunca vêm do cliente).
 *
 * Ordem: regras que pontuam → limites (`CAP`) → multiplicadores → multiplicador
 * do contexto. Estatística ausente ou inválida vale 0 ponto e nunca lança.
 */
export function computePoints(stats: Stats, rules: Rule[], ctx: ScoringContext = {}): PointsResult {
  const items: PointsBreakdownItem[] = [];

  rules.forEach((rule, ruleIndex) => {
    switch (rule.type) {
      case 'PER_UNIT': {
        const amount = toNumber(stats[rule.stat]) ?? 0;
        items.push({
          ruleIndex,
          type: rule.type,
          stat: rule.stat,
          points: roundPoints(amount * rule.points),
          label: `${amount} × ${pts(rule.points)} (${rule.stat})`,
        });
        break;
      }
      case 'TABLE': {
        const raw = stats[rule.stat];
        const numeric = toNumber(raw);
        const key = numeric !== undefined ? String(numeric) : typeof raw === 'string' ? raw.trim() : undefined;
        const points = key !== undefined ? (toNumber(rule.table[key]) ?? 0) : 0;
        items.push({
          ruleIndex,
          type: rule.type,
          stat: rule.stat,
          points,
          label: key !== undefined && key !== '' ? `${rule.stat} ${key} → ${pts(points)}` : `${rule.stat} não informado`,
        });
        break;
      }
      case 'OUTCOME': {
        const outcome = stats.outcome;
        const points = outcome === 'win' ? rule.win : outcome === 'draw' ? rule.draw : outcome === 'loss' ? rule.loss : 0;
        items.push({
          ruleIndex,
          type: rule.type,
          points: toNumber(points) ?? 0,
          label: (typeof outcome === 'string' ? OUTCOME_LABEL[outcome] : undefined) ?? 'Sem resultado',
        });
        break;
      }
      case 'BONUS': {
        const amount = toNumber(stats[rule.stat]);
        const hit =
          amount !== undefined &&
          (rule.op === 'gte' ? amount >= rule.value : rule.op === 'lte' ? amount <= rule.value : amount === rule.value);
        items.push({
          ruleIndex,
          type: rule.type,
          stat: rule.stat,
          points: hit ? rule.points : 0,
          label: `Bônus: ${rule.stat} ${OP_SYMBOL[rule.op] ?? rule.op} ${rule.value}`,
        });
        break;
      }
      default:
        break;
    }
  });

  rules.forEach((rule, ruleIndex) => {
    if (rule.type !== 'CAP') return;
    const earned = items.reduce((sum, item) => (item.stat === rule.stat ? sum + item.points : sum), 0);
    items.push({
      ruleIndex,
      type: rule.type,
      stat: rule.stat,
      points: earned > rule.max ? roundPoints(rule.max - earned) : 0,
      label: `Limite de ${pts(rule.max)} em ${rule.stat}`,
    });
  });

  let total = roundPoints(items.reduce((sum, item) => sum + item.points, 0));

  rules.forEach((rule, ruleIndex) => {
    if (rule.type !== 'MULTIPLIER') return;
    const applies = multiplierApplies(rule, ctx);
    const next = applies ? roundPoints(total * rule.factor) : total;
    items.push({
      ruleIndex,
      type: rule.type,
      points: roundPoints(next - total),
      label: `Multiplicador ×${rule.factor}${applies ? '' : ' (não se aplica)'}`,
    });
    total = next;
  });

  items.sort((a, b) => a.ruleIndex - b.ruleIndex);

  if (ctx.multiplier !== undefined && ctx.multiplier !== 1) {
    const next = roundPoints(total * ctx.multiplier);
    items.push({
      ruleIndex: -1,
      type: 'MULTIPLIER',
      points: roundPoints(next - total),
      label: `Multiplicador da partida ×${ctx.multiplier}`,
    });
    total = next;
  }

  return { total, breakdown: items };
}

// ───────────────────────────── Validação ─────────────────────────────

export const TIEBREAKERS: readonly Tiebreaker[] = [
  'points',
  'wins',
  'booyahs',
  'kills',
  'score',
  'avgPlacement',
  'headToHead',
  'scoreDiff',
  'lastDropKills',
  'draw',
];

const MATCH_TYPES = ['DUEL', 'TEAM_VS_TEAM', 'BATTLE_ROYALE'];
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function validateRule(rule: Rule, index: number, scoredStats: Set<string>): string[] {
  const at = `Regra ${index + 1}:`;
  const raw = rule as unknown as Record<string, unknown> | null;
  const type = raw && typeof raw === 'object' ? raw.type : undefined;
  const needsStat = type === 'PER_UNIT' || type === 'TABLE' || type === 'BONUS' || type === 'CAP';
  if (needsStat && !isText(raw?.stat)) return [`${at} informe a estatística.`];

  switch (rule?.type) {
    case 'PER_UNIT':
      return isNumber(rule.points) ? [] : [`${at} os pontos precisam ser um número.`];
    case 'TABLE': {
      const entries = rule.table && typeof rule.table === 'object' ? Object.entries(rule.table) : [];
      if (entries.length === 0) return [`${at} a tabela precisa de ao menos uma linha.`];
      return entries
        .filter(([, value]) => !isNumber(value))
        .map(([key]) => `${at} o valor de "${key}" na tabela precisa ser um número.`);
    }
    case 'OUTCOME':
      return isNumber(rule.win) && isNumber(rule.draw) && isNumber(rule.loss)
        ? []
        : [`${at} informe os pontos de vitória, empate e derrota.`];
    case 'BONUS': {
      if (!['gte', 'lte', 'eq'].includes(rule.op)) return [`${at} a condição do bônus precisa ser "gte", "lte" ou "eq".`];
      if (!isNumber(rule.value)) return [`${at} o valor de comparação precisa ser um número.`];
      return isNumber(rule.points) ? [] : [`${at} os pontos precisam ser um número.`];
    }
    case 'CAP': {
      if (!isNumber(rule.max)) return [`${at} o limite precisa ser um número.`];
      if (rule.max < 0) return [`${at} o limite não pode ser negativo.`];
      return scoredStats.has(rule.stat) ? [] : [`${at} o limite se refere a "${rule.stat}", que nenhuma regra pontua.`];
    }
    case 'MULTIPLIER': {
      if (!isNumber(rule.factor) || rule.factor <= 0) return [`${at} o multiplicador precisa ser maior que zero.`];
      const target = rule.when?.matchIndex;
      const ok = target === undefined || target === 'last' || (Number.isInteger(target) && target >= 1);
      return ok ? [] : [`${at} a partida do multiplicador precisa ser um número inteiro a partir de 1 ou "last".`];
    }
    default:
      return [`${at} tipo de regra desconhecido.`];
  }
}

/** Confere um modelo de pontuação. Devolve mensagens em pt-BR; lista vazia = válido. */
export function validateScoringModel(model: ScoringModel): string[] {
  const errors: string[] = [];
  if (!isText(model.id)) errors.push('Informe o identificador do modelo.');
  if (!isText(model.name)) errors.push('Informe o nome do modelo.');
  if (!isText(model.gameSlug)) errors.push('Informe o jogo do modelo.');
  if (!MATCH_TYPES.includes(model.matchType)) errors.push('Tipo de partida inválido.');

  const rules = Array.isArray(model.rules) ? model.rules : [];
  const scoring = rules.filter((r) => r && r.type !== 'CAP' && r.type !== 'MULTIPLIER');
  if (scoring.length === 0) {
    errors.push('Adicione ao menos uma regra de pontuação.');
  } else {
    const scoredStats = new Set<string>();
    for (const rule of scoring) if ('stat' in rule && isText(rule.stat)) scoredStats.add(rule.stat);
    rules.forEach((rule, index) => errors.push(...validateRule(rule, index, scoredStats)));
  }

  if (!Array.isArray(model.tiebreakers)) {
    errors.push('Informe a lista de critérios de desempate.');
  } else {
    const seen = new Set<string>();
    for (const tiebreaker of model.tiebreakers) {
      if (!TIEBREAKERS.includes(tiebreaker)) errors.push(`Critério de desempate desconhecido: ${String(tiebreaker)}.`);
      else if (seen.has(tiebreaker)) errors.push(`Critério de desempate repetido: ${tiebreaker}.`);
      seen.add(tiebreaker);
    }
  }
  return errors;
}

// ───────────────────────────── Modelos padrão ─────────────────────────────

/** Modelos do catálogo (PRD §11.2). O organizador pode copiar e personalizar. */
export const DEFAULT_SCORING_MODELS: ScoringModel[] = [
  {
    id: 'ff-br-padrao',
    name: 'Free Fire · Battle Royale padrão',
    gameSlug: 'free-fire',
    matchType: 'BATTLE_ROYALE',
    rules: [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
    ],
    tiebreakers: ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'],
    isDefault: true,
  },
  {
    id: 'ff-br-liga',
    name: 'Free Fire · Battle Royale liga',
    gameSlug: 'free-fire',
    matchType: 'BATTLE_ROYALE',
    rules: [
      {
        type: 'TABLE',
        stat: 'placement',
        table: { '1': 12, '2': 9, '3': 8, '4': 7, '5': 6, '6': 5, '7': 4, '8': 3, '9': 2, '10': 1, '11': 0, '12': 0 },
      },
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
    ],
    tiebreakers: ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'],
    isDefault: false,
  },
  {
    id: 'ff-contra-squad',
    name: 'Free Fire · Contra Squad',
    gameSlug: 'free-fire',
    matchType: 'TEAM_VS_TEAM',
    rules: [{ type: 'OUTCOME', win: 3, draw: 0, loss: 0 }],
    tiebreakers: ['points', 'wins', 'scoreDiff', 'score', 'headToHead', 'draw'],
    isDefault: true,
  },
  {
    id: 'cr-1v1',
    name: 'Clash Royale · 1v1',
    gameSlug: 'clash-royale',
    matchType: 'DUEL',
    rules: [
      { type: 'PER_UNIT', stat: 'crowns', points: 1 },
      { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
    ],
    tiebreakers: ['points', 'scoreDiff', 'score', 'headToHead', 'draw'],
    isDefault: true,
  },
  {
    id: 'cr-2v2',
    name: 'Clash Royale · 2v2',
    gameSlug: 'clash-royale',
    matchType: 'DUEL',
    rules: [
      { type: 'PER_UNIT', stat: 'crowns', points: 1 },
      { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
    ],
    tiebreakers: ['points', 'scoreDiff', 'score', 'headToHead', 'draw'],
    isDefault: true,
  },
  {
    id: 'efootball-1v1',
    name: 'eFootball · 1v1',
    gameSlug: 'efootball',
    matchType: 'DUEL',
    rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }],
    tiebreakers: ['points', 'scoreDiff', 'score', 'headToHead', 'draw'],
    isDefault: true,
  },
  {
    id: '8ball-1v1',
    name: '8 Ball Pool · 1v1',
    gameSlug: '8-ball-pool',
    matchType: 'DUEL',
    rules: [
      { type: 'PER_UNIT', stat: 'frames', points: 1 },
      { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
    ],
    tiebreakers: ['points', 'scoreDiff', 'headToHead', 'draw'],
    isDefault: true,
  },
];
