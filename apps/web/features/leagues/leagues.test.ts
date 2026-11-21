import { DEFAULT_LEAGUE_RULE } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { defaultLeagueValues, toLeagueInput, type LeagueFormValues } from './LeagueForm';
import { parsePoints, periodText, pointsText, ruleSummary } from './leagueText';

const VALUES: LeagueFormValues = {
  name: 'Liga das Quintas',
  description: '',
  gameId: 'g_clashroyale',
  startsAt: '2026-01-01T00:00',
  endsAt: '2026-06-30T23:59',
  placementPoints: '10, 7, 5',
  participationPoints: '1',
};

describe('textos da liga', () => {
  it('lê os pontos por colocação com vírgula, ponto e vírgula ou espaço', () => {
    expect(parsePoints('25, 18;15  12')).toEqual([25, 18, 15, 12]);
    expect(parsePoints('')).toBeNull();
    expect(parsePoints('10, dez')).toBeNull();
    expect(parsePoints('10, -1')).toBeNull();
    expect(pointsText([3, 2, 1])).toBe('3, 2, 1');
  });

  it('resume a regra e o período (fim exclusivo mostra o dia anterior)', () => {
    expect(ruleSummary(DEFAULT_LEAGUE_RULE)).toBe('1º 25 · 2º 18 · 3º 15 · 4º 12 · 5º 10 … · +1 por participar');
    expect(ruleSummary({ placementPoints: [3, 1], participationPoints: 0 })).toBe('1º 3 · 2º 1');
    expect(periodText('2026-01-01T03:00:00.000Z', '2027-01-01T03:00:00.000Z')).toMatch(/^01\/01\/2026 a 31\/12\/2026$/);
  });
});

describe('formulário da liga', () => {
  it('monta o contrato da API', () => {
    const result = toLeagueInput(VALUES);
    expect('input' in result && result.input).toMatchObject({ name: 'Liga das Quintas', gameId: 'g_clashroyale', rule: { placementPoints: [10, 7, 5], participationPoints: 1 } });
  });

  it('erros por campo: pontos ilegíveis, crescentes, participação e datas', () => {
    expect(toLeagueInput({ ...VALUES, placementPoints: 'muitos' })).toEqual({ errors: { placementPoints: expect.stringContaining('números inteiros') } });
    expect(toLeagueInput({ ...VALUES, placementPoints: '5, 9' })).toEqual({ errors: { placementPoints: 'Uma colocação não pode valer mais do que a anterior' } });
    expect(toLeagueInput({ ...VALUES, participationPoints: '-1' })).toEqual({ errors: { participationPoints: 'Use um número inteiro a partir de 0' } });
    expect(toLeagueInput({ ...VALUES, participationPoints: '500' })).toEqual({ errors: { participationPoints: 'Use no máximo 100 pontos' } });
    expect(toLeagueInput({ ...VALUES, endsAt: '2025-01-01T00:00' })).toEqual({ errors: { endsAt: 'O fim precisa ser depois do início' } });
    expect(toLeagueInput({ ...VALUES, startsAt: '' })).toEqual({ errors: { startsAt: 'Informe o início' } });
    expect(toLeagueInput({ ...VALUES, name: 'Li' })).toEqual({ errors: { name: 'Use pelo menos 3 caracteres' } });
  });

  it('valores iniciais: regra padrão para criar; os da liga para editar', () => {
    expect(defaultLeagueValues()).toMatchObject({ name: '', placementPoints: '25, 18, 15, 12, 10, 8, 6, 4, 2, 1', participationPoints: '1' });
    const edit = defaultLeagueValues({
      id: 'l',
      slug: 'l',
      name: 'Liga',
      description: 'd',
      game: { id: 'g', slug: 'g', name: 'G', icon: '🎮' },
      owner: { id: 'o', nickname: 'Org' },
      startsAt: '2026-01-01T03:00:00.000Z',
      endsAt: '2027-01-01T03:00:00.000Z',
      status: 'ACTIVE',
      rule: { placementPoints: [3, 2], participationPoints: 0 },
      tournaments: [],
      createdAt: '2026-01-01T03:00:00.000Z',
    });
    expect(edit).toMatchObject({ name: 'Liga', gameId: 'g', placementPoints: '3, 2', participationPoints: '0' });
  });
});
