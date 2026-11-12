import type { ScoringRule } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import {
  defaultExample,
  describeExample,
  describeModel,
  describeRule,
  exampleContext,
  exampleFields,
  exampleStats,
  MATCH_TYPE_LABELS,
  pts,
  RULE_TYPE_INFO,
  RULE_TYPES,
  ruleStatOptions,
  scoreLabelForGame,
  signed,
  statOptions,
} from './describe';
import { LEAGUE_TABLE } from './rules';

describe('describeRule', () => {
  it('PER_UNIT: pontos por unidade, com singular e plural', () => {
    expect(describeRule({ type: 'PER_UNIT', stat: 'kills', points: 1 })).toBe('1 ponto por kill');
    expect(describeRule({ type: 'PER_UNIT', stat: 'kills', points: 2 })).toBe('2 pontos por kill');
    expect(describeRule({ type: 'PER_UNIT', stat: 'kills', points: 0.5 })).toBe('0,5 pontos por kill');
  });

  it('PER_UNIT: o placar leva o nome do jogo, ou "placar" quando não sabemos o jogo', () => {
    const rule: ScoringRule = { type: 'PER_UNIT', stat: 'score', points: 1 };
    expect(describeRule(rule, { scoreLabel: 'coroas' })).toBe('1 ponto por coroa');
    expect(describeRule(rule, { scoreLabel: 'gols' })).toBe('1 ponto por gol');
    expect(describeRule(rule, { scoreLabel: 'frames' })).toBe('1 ponto por frame');
    expect(describeRule(rule)).toBe('1 ponto por ponto de placar');
  });

  it('PER_UNIT: estatística extra usa o rótulo cadastrado no jogo', () => {
    const extraStats = [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' as const }];
    expect(describeRule({ type: 'PER_UNIT', stat: 'penalties', points: 1 }, { extraStats })).toBe('1 ponto por pênaltis');
    expect(describeRule({ type: 'PER_UNIT', stat: 'assists', points: 1 })).toBe('1 ponto por assists');
  });

  it('TABLE: só o 1º lugar pontuando vira "Booyah vale N"', () => {
    expect(describeRule({ type: 'TABLE', stat: 'placement', table: { '1': 3 } })).toBe('Booyah (1º lugar) vale 3 pontos');
  });

  it('TABLE: tabela de colocação completa, em ordem', () => {
    expect(describeRule({ type: 'TABLE', stat: 'placement', table: { '2': 9, '1': 12, '10': 1, '3': 8 } })).toBe('Pontos por colocação: 1º = 12, 2º = 9, 3º = 8, 10º = 1');
    expect(describeRule({ type: 'TABLE', stat: 'placement', table: LEAGUE_TABLE })).toBe(
      'Pontos por colocação: 1º = 12, 2º = 9, 3º = 8, 4º = 7, 5º = 6, 6º = 5, 7º = 4, 8º = 3, 9º = 2, 10º = 1, 11º = 0, 12º = 0',
    );
  });

  it('TABLE: outras estatísticas e tabela vazia', () => {
    expect(describeRule({ type: 'TABLE', stat: 'score', table: { '0': 0, '3': 5 } }, { scoreLabel: 'gols' })).toBe('Pontos por gols: 0 = 0, 3 = 5');
    expect(describeRule({ type: 'TABLE', stat: 'kills', table: {} })).toBe('Tabela de kills ainda sem valores');
  });

  it('OUTCOME: vitória, empate e derrota', () => {
    expect(describeRule({ type: 'OUTCOME', win: 3, draw: 1, loss: 0 })).toBe('Vitória vale 3 pontos, empate 1 e derrota 0');
  });

  it('BONUS: as três condições', () => {
    expect(describeRule({ type: 'BONUS', stat: 'kills', op: 'gte', value: 10, points: 2 })).toBe('+2 pontos com 10 kills ou mais');
    expect(describeRule({ type: 'BONUS', stat: 'kills', op: 'lte', value: 1, points: -1 })).toBe('−1 ponto com 1 kill ou menos');
    expect(describeRule({ type: 'BONUS', stat: 'score', op: 'eq', value: 3, points: 1 }, { scoreLabel: 'coroas' })).toBe('+1 ponto com exatamente 3 coroas');
  });

  it('BONUS por colocação fala em lugar, não em quantidade', () => {
    expect(describeRule({ type: 'BONUS', stat: 'placement', op: 'lte', value: 3, points: 2 })).toBe('+2 pontos para quem ficar até o 3º lugar');
    expect(describeRule({ type: 'BONUS', stat: 'placement', op: 'eq', value: 1, points: 5 })).toBe('+5 pontos para o 1º lugar');
    expect(describeRule({ type: 'BONUS', stat: 'placement', op: 'gte', value: 10, points: -1 })).toBe('−1 ponto para quem ficar do 10º lugar para baixo');
  });

  it('CAP: teto de pontos de uma estatística, por queda ou por partida', () => {
    expect(describeRule({ type: 'CAP', stat: 'kills', max: 15 }, { matchType: 'BATTLE_ROYALE' })).toBe('No máximo 15 pontos de kills por queda');
    expect(describeRule({ type: 'CAP', stat: 'score', max: 3 }, { matchType: 'DUEL', scoreLabel: 'gols' })).toBe('No máximo 3 pontos de gols por partida');
  });

  it('MULTIPLIER: todas, a última ou uma queda específica', () => {
    expect(describeRule({ type: 'MULTIPLIER', factor: 2 }, { matchType: 'BATTLE_ROYALE' })).toBe('Todos os pontos da queda valem ×2');
    expect(describeRule({ type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } }, { matchType: 'BATTLE_ROYALE' })).toBe('A última queda vale ×2');
    expect(describeRule({ type: 'MULTIPLIER', factor: 1.5, when: { matchIndex: 3 } }, { matchType: 'BATTLE_ROYALE' })).toBe('A 3ª queda vale ×1,5');
    expect(describeRule({ type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } }, { matchType: 'DUEL' })).toBe('A última partida vale ×2');
  });

  it('todo tipo de regra tem nome e explicação', () => {
    expect(RULE_TYPES).toHaveLength(6);
    for (const type of RULE_TYPES) {
      expect(RULE_TYPE_INFO[type].label).not.toBe('');
      expect(RULE_TYPE_INFO[type].hint).toMatch(/Ex\.:/);
    }
  });
});

describe('describeModel', () => {
  it('descreve o modelo padrão do Free Fire, uma frase por regra', () => {
    expect(
      describeModel([
        { type: 'PER_UNIT', stat: 'kills', points: 1 },
        { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
      ]),
    ).toEqual(['1 ponto por kill', 'Booyah (1º lugar) vale 3 pontos']);
  });
});

describe('estatísticas por tipo de partida', () => {
  it('Battle Royale oferece kills e colocação; duelo e equipe, placar e resultado', () => {
    expect(statOptions('BATTLE_ROYALE').map((s) => s.key)).toEqual(['kills', 'placement']);
    expect(statOptions('DUEL').map((s) => s.key)).toEqual(['score', 'outcome']);
    expect(statOptions('TEAM_VS_TEAM').map((s) => s.key)).toEqual(['score', 'outcome']);
  });

  it('soma as estatísticas extras do jogo', () => {
    const extraStats = [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' as const }];
    expect(statOptions('DUEL', { extraStats }).map((s) => s.label)).toEqual(['Placar', 'Resultado', 'Pênaltis']);
  });

  it('o resultado não entra nas regras com estatística: ele tem a regra própria', () => {
    expect(ruleStatOptions('DUEL', { scoreLabel: 'gols' }).map((s) => s.label)).toEqual(['Gols']);
  });

  it('sabe o nome do placar nos jogos do lançamento e cai no genérico nos demais', () => {
    expect(scoreLabelForGame('clash-royale')).toBe('coroas');
    expect(scoreLabelForGame('efootball')).toBe('gols');
    expect(scoreLabelForGame('8-ball-pool')).toBe('frames');
    expect(scoreLabelForGame('jogo-novo')).toBeUndefined();
    expect(scoreLabelForGame(undefined)).toBeUndefined();
  });

  it('nomeia os três tipos de partida', () => {
    expect(MATCH_TYPE_LABELS).toEqual({ DUEL: 'Duelo', TEAM_VS_TEAM: 'Equipe x Equipe', BATTLE_ROYALE: 'Battle Royale' });
  });
});

describe('exemplos padrão', () => {
  it('Battle Royale: 7 kills e 1º lugar (CT-01)', () => {
    expect(defaultExample('BATTLE_ROYALE')).toEqual({ kills: 7, placement: 1 });
  });

  it('duelo e equipe x equipe: placar 2 e vitória', () => {
    expect(defaultExample('DUEL')).toEqual({ score: 2, outcome: 'win' });
    expect(defaultExample('TEAM_VS_TEAM')).toEqual({ score: 2, outcome: 'win' });
  });

  it('o exemplo ganha as estatísticas que as regras usam e o tipo de partida não tem', () => {
    const rules: ScoringRule[] = [
      { type: 'OUTCOME', win: 3, draw: 1, loss: 0 },
      { type: 'PER_UNIT', stat: 'penalties', points: 1 },
    ];
    expect(exampleStats(rules, 'DUEL')).toEqual({ score: 2, outcome: 'win', penalties: 2 });
    expect(exampleFields(rules, 'DUEL').map((f) => f.key)).toEqual(['score', 'outcome', 'penalties']);
  });

  it('escreve o exemplo por extenso', () => {
    expect(describeExample(exampleFields([], 'BATTLE_ROYALE'), { kills: 7, placement: 1 })).toBe('7 kills + 1º lugar');
    expect(describeExample(exampleFields([], 'BATTLE_ROYALE'), { kills: 1, placement: 12 })).toBe('1 kill + 12º lugar');
    expect(describeExample(exampleFields([], 'DUEL', { scoreLabel: 'coroas' }), { score: 2, outcome: 'win' })).toBe('2 coroas + vitória');
    expect(describeExample(exampleFields([], 'DUEL'), { score: 1, outcome: 'draw' })).toBe('1 ponto de placar + empate');
  });

  it('multiplicador de uma queda específica leva o exemplo para essa queda', () => {
    expect(exampleContext([{ type: 'MULTIPLIER', factor: 2 }])).toBeNull();
    expect(exampleContext([{ type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } }])).toEqual({ matchIndex: 3, matchCount: 3 });
    expect(exampleContext([{ type: 'MULTIPLIER', factor: 2, when: { matchIndex: 5 } }])).toEqual({ matchIndex: 5, matchCount: 5 });
    const ctx = { matchIndex: 3, matchCount: 3 };
    expect(describeExample(exampleFields([], 'BATTLE_ROYALE'), { kills: 7, placement: 1 }, { matchType: 'BATTLE_ROYALE' }, ctx)).toBe('7 kills + 1º lugar (queda 3 de 3)');
  });
});

describe('números', () => {
  it('abrevia pontos e põe sinal nas parcelas', () => {
    expect(pts(10)).toBe('10 pts');
    expect(pts(1)).toBe('1 pt');
    expect(pts(2.5)).toBe('2,5 pts');
    expect(signed(7)).toBe('+7');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
  });
});
