import { TIEBREAKERS } from '@nova/engine';
import type { Tiebreaker } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { changeMatchType, changeRuleType, fillPlacements, LEAGUE_TABLE, moveItem, newDraft, newRule } from './rules';
import { ALL_TIEBREAKERS, defaultTiebreakers, moveTiebreaker, normalizeTiebreakers, tiebreakerLabel, tiebreakersFor, toggleTiebreaker } from './tiebreakers';
import { RULE_TYPES } from './describe';
import { fieldErrorsToMessages, groupErrors, toFieldErrors, validateDraft } from './validation';

describe('regras', () => {
  it('cria uma regra válida de cada tipo, para cada tipo de partida', () => {
    for (const matchType of ['BATTLE_ROYALE', 'DUEL', 'TEAM_VS_TEAM'] as const) {
      for (const type of RULE_TYPES) {
        const base = newDraft(matchType, 'Teste');
        const rules = [...base.rules, newRule('PER_UNIT', matchType)];
        const draft = { ...base, rules: [...rules, newRule(type, matchType, [], rules)] };
        expect(validateDraft(draft), `${matchType} + ${type}`).toEqual([]);
      }
    }
  });

  it('o limite novo aponta para uma estatística que já pontua', () => {
    expect(newRule('CAP', 'BATTLE_ROYALE', [], [{ type: 'TABLE', stat: 'placement', table: { '1': 3 } }])).toEqual({ type: 'CAP', stat: 'placement', max: 15 });
    expect(newRule('CAP', 'BATTLE_ROYALE')).toEqual({ type: 'CAP', stat: 'kills', max: 15 });
  });

  it('a tabela de liga é 12/9/8/7/6/5/4/3/2/1 e zero do 11º em diante', () => {
    expect(Object.values(LEAGUE_TABLE)).toEqual([12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
  });

  it('preenche as colocações de 1 a N mantendo os pontos que já existiam', () => {
    expect(fillPlacements({ '1': 3 }, 4)).toEqual({ '1': 3, '2': 0, '3': 0, '4': 0 });
    expect(fillPlacements(LEAGUE_TABLE, 2)).toEqual({ '1': 12, '2': 9 });
  });

  it('trocar o tipo da regra aproveita a estatística', () => {
    expect(changeRuleType({ type: 'PER_UNIT', stat: 'placement', points: 1 }, 'CAP', 'BATTLE_ROYALE')).toEqual({ type: 'CAP', stat: 'placement', max: 15 });
    expect(changeRuleType({ type: 'PER_UNIT', stat: 'kills', points: 1 }, 'OUTCOME', 'DUEL')).toEqual({ type: 'OUTCOME', win: 3, draw: 1, loss: 0 });
  });

  it('move um item da lista', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
  });

  it('trocar o tipo de partida mantém só as regras que valem e volta o desempate ao padrão', () => {
    const br = newDraft('BATTLE_ROYALE', 'Padrão');
    const withMultiplier = { ...br, rules: [...br.rules, newRule('MULTIPLIER', 'BATTLE_ROYALE')] };
    const duel = changeMatchType(withMultiplier, 'DUEL');
    expect(duel.matchType).toBe('DUEL');
    expect(duel.rules).toEqual([
      { type: 'OUTCOME', win: 3, draw: 1, loss: 0 },
      { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } },
    ]);
    expect(duel.tiebreakers).toEqual(defaultTiebreakers('DUEL'));
    expect(validateDraft(duel)).toEqual([]);
  });
});

describe('critérios de desempate', () => {
  it('cobre os 8 critérios do PRD, todos com nome em português', () => {
    // 10 valores no contrato: `wins`/`booyahs` e `score`/`kills` são o mesmo critério do PRD com o nome de cada tipo de partida.
    expect(ALL_TIEBREAKERS).toEqual([...TIEBREAKERS]);
    expect(ALL_TIEBREAKERS.map((t) => tiebreakerLabel(t))).toEqual([
      'Pontos totais',
      'Vitórias',
      'Booyahs (vitórias na queda)',
      'Total de kills',
      'Placar feito (coroas, gols, frames)',
      'Melhor colocação média',
      'Confronto direto',
      'Saldo do placar',
      'Kills na última queda',
      'Sorteio',
    ]);
    expect(tiebreakerLabel('score', { matchType: 'DUEL', scoreLabel: 'gols' })).toBe('Placar feito (gols)');
    expect(tiebreakerLabel('scoreDiff', { matchType: 'DUEL', scoreLabel: 'gols' })).toBe('Saldo de gols');
  });

  it('oferece por tipo de partida só os critérios que fazem sentido', () => {
    expect(tiebreakersFor('BATTLE_ROYALE')).toEqual(['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw']);
    expect(tiebreakersFor('DUEL')).toEqual(['points', 'wins', 'scoreDiff', 'score', 'headToHead', 'draw']);
    expect(tiebreakersFor('TEAM_VS_TEAM')).toEqual(tiebreakersFor('DUEL'));
    for (const matchType of ['BATTLE_ROYALE', 'DUEL', 'TEAM_VS_TEAM'] as const) {
      for (const t of defaultTiebreakers(matchType)) expect(tiebreakersFor(matchType)).toContain(t);
    }
  });

  it('"pontos" fica sempre em primeiro e "sorteio", quando ligado, por último', () => {
    expect(normalizeTiebreakers(['draw', 'wins', 'points', 'score'])).toEqual(['points', 'wins', 'score', 'draw']);
    expect(normalizeTiebreakers(['wins', 'wins', 'score'])).toEqual(['points', 'wins', 'score']);
  });

  it('reordena só entre "pontos" e "sorteio"', () => {
    const list: Tiebreaker[] = ['points', 'wins', 'score', 'avgPlacement', 'draw'];
    expect(moveTiebreaker(list, 'wins', 2)).toEqual(['points', 'score', 'wins', 'avgPlacement', 'draw']);
    expect(moveTiebreaker(list, 'avgPlacement', 0)).toEqual(['points', 'avgPlacement', 'wins', 'score', 'draw']);
    expect(moveTiebreaker(list, 'wins', 4)).toEqual(['points', 'score', 'avgPlacement', 'wins', 'draw']);
    expect(moveTiebreaker(list, 'points', 3)).toEqual(list);
    expect(moveTiebreaker(list, 'draw', 1)).toEqual(list);
  });

  it('liga e desliga critérios; "pontos" não desliga', () => {
    const list: Tiebreaker[] = ['points', 'wins', 'draw'];
    expect(toggleTiebreaker(list, 'headToHead', true)).toEqual(['points', 'wins', 'headToHead', 'draw']);
    expect(toggleTiebreaker(list, 'wins', false)).toEqual(['points', 'draw']);
    expect(toggleTiebreaker(list, 'draw', false)).toEqual(['points', 'wins']);
    expect(toggleTiebreaker(['points', 'wins'], 'draw', true)).toEqual(['points', 'wins', 'draw']);
    expect(toggleTiebreaker(list, 'points', false)).toEqual(list);
  });
});

describe('erros do motor', () => {
  it('separa as mensagens por regra, nome, desempate e gerais', () => {
    const errors = validateDraft({
      name: '',
      matchType: 'BATTLE_ROYALE',
      rules: [
        { type: 'PER_UNIT', stat: 'kills', points: 1 },
        { type: 'CAP', stat: 'score', max: 5 },
        { type: 'TABLE', stat: 'placement', table: {} },
      ],
      tiebreakers: ['points', 'points'],
    });
    const grouped = groupErrors(errors);
    expect(grouped.name).toBe('Informe o nome do modelo.');
    expect(grouped.byRule[1]).toEqual(['O limite se refere a "score", que nenhuma regra pontua.']);
    expect(grouped.byRule[2]).toEqual(['A tabela precisa de ao menos uma linha.']);
    expect(grouped.byRule[0]).toBeUndefined();
    expect(grouped.tiebreakers).toEqual(['Critério de desempate repetido: points.']);
    expect(grouped.general).toEqual([]);
  });

  it('modelo sem regra que pontue gera um erro geral', () => {
    const errors = validateDraft({ name: 'Só limite', matchType: 'DUEL', rules: [{ type: 'MULTIPLIER', factor: 2 }], tiebreakers: ['points'] });
    expect(groupErrors(errors).general).toEqual(['Adicione ao menos uma regra de pontuação.']);
  });

  it('vira erro por campo na API e volta para o editor', () => {
    const fields = toFieldErrors(['Informe o nome do modelo.', 'Regra 2: a tabela precisa de ao menos uma linha.']);
    expect(fields).toEqual({ name: 'Informe o nome do modelo.', 'rules.1': 'A tabela precisa de ao menos uma linha.' });
    expect(fieldErrorsToMessages(fields)).toEqual(['Informe o nome do modelo.', 'Regra 2: a tabela precisa de ao menos uma linha.']);
    expect(fieldErrorsToMessages({ 'rules.0.points': 'Invalid input' })).toEqual(['Regra 1: invalid input']);
  });
});
