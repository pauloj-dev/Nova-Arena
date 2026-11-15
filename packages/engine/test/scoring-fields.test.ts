/** Erros por campo do modelo de pontuação (issue #74): a mesma conversão na tela e na API. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_MODELS, groupScoringErrors, normalizeTiebreakers, SCORING_NAME_ERROR, scoringFieldErrors, validateScoringDraft } from '../src';

describe('modelo de pontuação com erro por campo', () => {
  it('os modelos padrão são válidos', () => {
    for (const m of DEFAULT_SCORING_MODELS) expect(validateScoringDraft(m), m.name).toEqual([]);
  });

  it('nome vazio vai para o campo "name"; regra ruim vai para "rules.N"', () => {
    const errors = validateScoringDraft({ name: ' ', matchType: 'BATTLE_ROYALE', rules: [{ type: 'PER_UNIT', stat: '', points: 1 }], tiebreakers: ['points'] });
    expect(errors).toContain(SCORING_NAME_ERROR);
    const fields = scoringFieldErrors(errors);
    expect(fields.name).toBe(SCORING_NAME_ERROR);
    expect(Object.keys(fields)).toContain('rules.0');
    expect(fields['rules.0']?.charAt(0)).toBe(fields['rules.0']?.charAt(0).toUpperCase());
  });

  it('sem regras e desempate inválido: mensagens gerais e de desempate', () => {
    const grouped = groupScoringErrors(['Adicione ao menos uma regra de pontuação.', 'O primeiro critério de desempate precisa ser "pontos".', 'Regra 2: informe a estatística.']);
    expect(grouped.general).toEqual(['Adicione ao menos uma regra de pontuação.']);
    expect(grouped.tiebreakers).toHaveLength(1);
    expect(grouped.byRule[1]).toEqual(['Informe a estatística.']);
    expect(scoringFieldErrors(['Adicione ao menos uma regra de pontuação.'])).toEqual({ rules: 'Adicione ao menos uma regra de pontuação.' });
    expect(scoringFieldErrors(['O desempate não pode repetir critérios.'])).toEqual({ tiebreakers: 'O desempate não pode repetir critérios.' });
  });

  it('desempate: pontos primeiro, sorteio por último, sem repetidos nem desconhecidos', () => {
    expect(normalizeTiebreakers(['kills', 'draw', 'points', 'kills', 'xyz' as never, 'wins'])).toEqual(['points', 'kills', 'wins', 'draw']);
    expect(normalizeTiebreakers([])).toEqual(['points']);
  });
});
