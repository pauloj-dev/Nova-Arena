import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_MODELS, computePoints, validateScoringModel } from '../src/index';
import type { Rule, ScoringModel } from '../src/index';

const model = (id: string): ScoringModel => {
  const found = DEFAULT_SCORING_MODELS.find((m) => m.id === id);
  if (!found) throw new Error(`modelo ${id} não existe`);
  return found;
};

describe('computePoints — CT-01 (Free Fire padrão)', () => {
  const rules = model('ff-br-padrao').rules;

  it.each([
    ['Alfa', { kills: 7, placement: 1 }, 10],
    ['Bravo', { kills: 9, placement: 2 }, 9],
    ['Charlie', { kills: 4, placement: 3 }, 4],
  ])('Squad %s', (_name, stats, expected) => {
    expect(computePoints(stats, rules).total).toBe(expected);
  });

  it('bate com o exemplo do PRD §19.4', () => {
    const total = computePoints({ kills: 7, placement: 1 }, [
      { stat: 'kills', type: 'PER_UNIT', points: 1 },
      { stat: 'placement', type: 'TABLE', table: { '1': 3 } },
    ]).total;
    expect(total).toBe(10);
  });

  it('detalha de onde veio cada ponto', () => {
    const { breakdown } = computePoints({ kills: 7, placement: 1 }, rules);
    expect(breakdown).toEqual([
      { ruleIndex: 0, type: 'PER_UNIT', stat: 'kills', points: 7, label: '7 × 1 pt (kills)' },
      { ruleIndex: 1, type: 'TABLE', stat: 'placement', points: 3, label: 'placement 1 → 3 pts' },
    ]);
  });
});

describe('computePoints — cada tipo de regra isolado', () => {
  it('PER_UNIT multiplica a quantidade', () => {
    expect(computePoints({ crowns: 3 }, [{ type: 'PER_UNIT', stat: 'crowns', points: 2 }]).total).toBe(6);
  });

  it('PER_UNIT aceita número em texto', () => {
    expect(computePoints({ crowns: '3' }, [{ type: 'PER_UNIT', stat: 'crowns', points: 1 }]).total).toBe(3);
  });

  it('TABLE usa o valor como chave; fora da tabela vale 0', () => {
    const rules: Rule[] = [{ type: 'TABLE', stat: 'placement', table: { '1': 12, '2': 9 } }];
    expect(computePoints({ placement: 2 }, rules).total).toBe(9);
    expect(computePoints({ placement: 7 }, rules).total).toBe(0);
    expect(computePoints({ placement: '1' }, rules).total).toBe(12);
  });

  it('OUTCOME lê stats.outcome', () => {
    const rules: Rule[] = [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }];
    expect(computePoints({ outcome: 'win' }, rules).total).toBe(3);
    expect(computePoints({ outcome: 'draw' }, rules).total).toBe(1);
    expect(computePoints({ outcome: 'loss' }, rules).total).toBe(0);
    expect(computePoints({ outcome: 'outro' }, rules).total).toBe(0);
    expect(computePoints({ outcome: 'draw' }, rules).breakdown[0]?.label).toBe('Empate');
  });

  it('BONUS com gte, lte e eq', () => {
    const bonus = (op: 'gte' | 'lte' | 'eq'): Rule[] => [{ type: 'BONUS', stat: 'kills', op, value: 10, points: 2 }];
    expect(computePoints({ kills: 10 }, bonus('gte')).total).toBe(2);
    expect(computePoints({ kills: 9 }, bonus('gte')).total).toBe(0);
    expect(computePoints({ kills: 9 }, bonus('lte')).total).toBe(2);
    expect(computePoints({ kills: 11 }, bonus('lte')).total).toBe(0);
    expect(computePoints({ kills: 10 }, bonus('eq')).total).toBe(2);
    expect(computePoints({ kills: 11 }, bonus('eq')).total).toBe(0);
  });

  it('CAP limita os pontos vindos de um stat', () => {
    const rules: Rule[] = [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
      { type: 'CAP', stat: 'kills', max: 15 },
    ];
    const result = computePoints({ kills: 22, placement: 1 }, rules);
    expect(result.total).toBe(18);
    expect(result.breakdown[2]).toMatchObject({ type: 'CAP', stat: 'kills', points: -7 });
    expect(computePoints({ kills: 5, placement: 1 }, rules).breakdown[2]?.points).toBe(0);
  });

  it('CAP vale mesmo declarado antes da regra que pontua', () => {
    const rules: Rule[] = [
      { type: 'CAP', stat: 'kills', max: 5 },
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'BONUS', stat: 'kills', op: 'gte', value: 10, points: 2 },
    ];
    expect(computePoints({ kills: 12 }, rules).total).toBe(5);
  });

  it('MULTIPLIER sem condição multiplica o total', () => {
    const rules: Rule[] = [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'MULTIPLIER', factor: 1.5 },
    ];
    expect(computePoints({ kills: 4 }, rules).total).toBe(6);
  });

  it('MULTIPLIER só na queda indicada', () => {
    const rules: Rule[] = [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 3 } },
    ];
    expect(computePoints({ kills: 4 }, rules, { matchIndex: 3 }).total).toBe(8);
    expect(computePoints({ kills: 4 }, rules, { matchIndex: 2 }).total).toBe(4);
    expect(computePoints({ kills: 4 }, rules).total).toBe(4);
  });

  it("MULTIPLIER 'last' só na última queda", () => {
    const rules: Rule[] = [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } },
    ];
    expect(computePoints({ kills: 4 }, rules, { matchIndex: 5, matchCount: 5 }).total).toBe(8);
    expect(computePoints({ kills: 4 }, rules, { matchIndex: 4, matchCount: 5 }).total).toBe(4);
    expect(computePoints({ kills: 4 }, rules, { matchIndex: 5 }).total).toBe(4);
  });

  it('multiplicador do contexto entra por último', () => {
    const result = computePoints({ kills: 4 }, [{ type: 'PER_UNIT', stat: 'kills', points: 1 }], { multiplier: 2 });
    expect(result.total).toBe(8);
    expect(result.breakdown.at(-1)).toMatchObject({ ruleIndex: -1, type: 'MULTIPLIER', points: 4 });
    expect(
      computePoints({ kills: 4 }, [{ type: 'PER_UNIT', stat: 'kills', points: 1 }], { multiplier: 1 }).breakdown,
    ).toHaveLength(1);
  });
});

describe('computePoints — CAP e MULTIPLIER combinados', () => {
  it('aplica o limite antes de multiplicar', () => {
    const rules: Rule[] = [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
      { type: 'CAP', stat: 'kills', max: 15 },
      { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } },
    ];
    const result = computePoints({ kills: 20, placement: 1 }, rules, { matchIndex: 5, matchCount: 5 });
    expect(result.total).toBe(36); // (15 + 3) × 2
    expect(result.breakdown.reduce((sum, item) => sum + item.points, 0)).toBe(36);
  });
});

describe('computePoints — estatística ausente', () => {
  const rules: Rule[] = [
    { type: 'PER_UNIT', stat: 'kills', points: 1 },
    { type: 'TABLE', stat: 'placement', table: { '0': 99, '1': 3 } },
    { type: 'OUTCOME', win: 3, draw: 1, loss: 0 },
    { type: 'BONUS', stat: 'deaths', op: 'lte', value: 0, points: 5 },
    { type: 'CAP', stat: 'kills', max: 15 },
    { type: 'MULTIPLIER', factor: 2 },
  ];

  it('conta como 0 e não lança', () => {
    expect(() => computePoints({}, rules)).not.toThrow();
    expect(computePoints({}, rules).total).toBe(0);
    expect(computePoints({ kills: undefined, placement: 'abc' }, rules).total).toBe(0);
    expect(computePoints({ kills: Number.NaN }, rules).total).toBe(0);
  });

  it('devolve um item por regra, na ordem das regras', () => {
    expect(computePoints({}, rules).breakdown.map((b) => b.ruleIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('sem regras, total 0', () => {
    expect(computePoints({ kills: 3 }, [])).toEqual({ total: 0, breakdown: [] });
  });

  it('não acumula erro de ponto flutuante', () => {
    expect(computePoints({ kills: 3 }, [{ type: 'PER_UNIT', stat: 'kills', points: 0.1 }]).total).toBe(0.3);
  });
});

describe('DEFAULT_SCORING_MODELS', () => {
  it('traz os sete modelos do catálogo, todos válidos', () => {
    expect(DEFAULT_SCORING_MODELS.map((m) => m.id)).toEqual([
      'ff-br-padrao',
      'ff-br-liga',
      'ff-contra-squad',
      'cr-1v1',
      'cr-2v2',
      'efootball-1v1',
      '8ball-1v1',
    ]);
    for (const m of DEFAULT_SCORING_MODELS) expect(validateScoringModel(m)).toEqual([]);
  });

  it('FF liga: 12/9/8/7/6/5/4/3/2/1/0/0 + 1 por kill', () => {
    const rules = model('ff-br-liga').rules;
    const table = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0];
    table.forEach((pts, i) => {
      expect(computePoints({ placement: i + 1, kills: 2 }, rules).total).toBe(pts + 2);
    });
  });

  it('FF Contra Squad: vitória vale 3', () => {
    const m = model('ff-contra-squad');
    expect(m.matchType).toBe('TEAM_VS_TEAM');
    expect(computePoints({ outcome: 'win' }, m.rules).total).toBe(3);
    expect(computePoints({ outcome: 'loss' }, m.rules).total).toBe(0);
  });

  it('Clash Royale 1v1 e 2v2: 1 por coroa + 3 por vitória', () => {
    for (const id of ['cr-1v1', 'cr-2v2']) {
      expect(computePoints({ crowns: 3, outcome: 'win' }, model(id).rules).total).toBe(6);
      expect(computePoints({ crowns: 1, outcome: 'loss' }, model(id).rules).total).toBe(1);
    }
  });

  it('eFootball: 3/1/0', () => {
    const rules = model('efootball-1v1').rules;
    expect(computePoints({ outcome: 'win', goals: 4 }, rules).total).toBe(3);
    expect(computePoints({ outcome: 'draw', goals: 1 }, rules).total).toBe(1);
    expect(computePoints({ outcome: 'loss', goals: 0 }, rules).total).toBe(0);
  });

  it('8 Ball Pool: 1 por frame + 3 por vitória de série', () => {
    const rules = model('8ball-1v1').rules;
    expect(computePoints({ frames: 2, outcome: 'win' }, rules).total).toBe(5);
    expect(computePoints({ frames: 1, outcome: 'loss' }, rules).total).toBe(1);
  });

  it('só o modelo de liga do FF não é padrão', () => {
    expect(DEFAULT_SCORING_MODELS.filter((m) => !m.isDefault).map((m) => m.id)).toEqual(['ff-br-liga']);
  });
});

describe('validateScoringModel', () => {
  const base = model('ff-br-padrao');
  const withRules = (rules: unknown[]): ScoringModel => ({ ...base, rules: rules as Rule[] });

  it('aceita um modelo válido', () => {
    expect(validateScoringModel(base)).toEqual([]);
  });

  it('exige identificação', () => {
    const errors = validateScoringModel({ ...base, id: '', name: ' ', gameSlug: '' });
    expect(errors).toEqual(['Informe o identificador do modelo.', 'Informe o nome do modelo.', 'Informe o jogo do modelo.']);
  });

  it('recusa tipo de partida desconhecido', () => {
    expect(validateScoringModel({ ...base, matchType: 'X' as never })).toEqual(['Tipo de partida inválido.']);
  });

  it('exige ao menos uma regra que pontue', () => {
    expect(validateScoringModel(withRules([]))).toEqual(['Adicione ao menos uma regra de pontuação.']);
    expect(validateScoringModel(withRules([{ type: 'MULTIPLIER', factor: 2 }]))).toEqual([
      'Adicione ao menos uma regra de pontuação.',
    ]);
    expect(validateScoringModel({ ...base, rules: undefined as never })).toEqual([
      'Adicione ao menos uma regra de pontuação.',
    ]);
  });

  it('aponta a regra com problema', () => {
    const errors = validateScoringModel(
      withRules([
        { type: 'PER_UNIT', stat: '', points: 1 },
        { type: 'PER_UNIT', stat: 'kills', points: Number.NaN },
        { type: 'TABLE', stat: 'placement', table: {} },
        { type: 'TABLE', stat: 'placement', table: { '1': 'x' } },
        { type: 'OUTCOME', win: 3, draw: 1 },
        { type: 'BONUS', stat: 'kills', op: 'gt', value: 1, points: 1 },
        { type: 'BONUS', stat: 'kills', op: 'gte', value: 'a', points: 1 },
        { type: 'CAP', stat: 'kills', max: -1 },
        { type: 'CAP', stat: 'assists', max: 5 },
        { type: 'MULTIPLIER', factor: 0 },
        { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 0 } },
        { type: 'NADA' },
        null,
      ]),
    );
    expect(errors).toEqual([
      'Regra 1: informe a estatística.',
      'Regra 2: os pontos precisam ser um número.',
      'Regra 3: a tabela precisa de ao menos uma linha.',
      'Regra 4: o valor de "1" na tabela precisa ser um número.',
      'Regra 5: informe os pontos de vitória, empate e derrota.',
      'Regra 6: a condição do bônus precisa ser "gte", "lte" ou "eq".',
      'Regra 7: o valor de comparação precisa ser um número.',
      'Regra 8: o limite não pode ser negativo.',
      'Regra 9: o limite se refere a "assists", que nenhuma regra pontua.',
      'Regra 10: o multiplicador precisa ser maior que zero.',
      'Regra 11: a partida do multiplicador precisa ser um número inteiro a partir de 1 ou "last".',
      'Regra 12: tipo de regra desconhecido.',
      'Regra 13: tipo de regra desconhecido.',
    ]);
  });

  it('valida os critérios de desempate', () => {
    expect(validateScoringModel({ ...base, tiebreakers: ['points', 'points', 'x' as never] })).toEqual([
      'Critério de desempate repetido: points.',
      'Critério de desempate desconhecido: x.',
    ]);
    expect(validateScoringModel({ ...base, tiebreakers: undefined as never })).toEqual([
      'Informe a lista de critérios de desempate.',
    ]);
  });

  it('aceita multiplicador com condição válida', () => {
    expect(
      validateScoringModel(
        withRules([
          { type: 'PER_UNIT', stat: 'kills', points: 1 },
          { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } },
          { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 2 } },
          { type: 'MULTIPLIER', factor: 2, when: {} },
        ]),
      ),
    ).toEqual([]);
  });
});
