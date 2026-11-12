import type { ScoringModel } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { defaultScoringModels, matchTypeText, scoringLines, scoringSummary, teamSizeText } from './scoringText';

function model(patch: Partial<ScoringModel>): ScoringModel {
  return { id: 'sm', gameId: 'g', name: 'Modelo', matchType: 'BATTLE_ROYALE', rules: [{ type: 'PER_UNIT', stat: 'kills', points: 1 }], tiebreakers: ['points'], isDefault: true, ownerId: null, ...patch };
}

const freeFire = { slug: 'free-fire', extraStatFields: [] };
const clash = { slug: 'clash-royale', extraStatFields: [] };
const efootball = { slug: 'efootball', extraStatFields: [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' as const }] };

describe('scoringSummary', () => {
  it('Free Fire padrão: kill vale 1 e Booyah vale 3, em uma linha', () => {
    const ff = model({
      rules: [
        { type: 'PER_UNIT', stat: 'kills', points: 1 },
        { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
      ],
    });
    expect(scoringSummary(ff, freeFire)).toBe('1 ponto por kill · Booyah (1º lugar) vale 3 pontos');
  });

  it('Clash Royale: o placar vira "coroa" e a vitória aparece com empate e derrota', () => {
    const cr = model({
      matchType: 'DUEL',
      rules: [
        { type: 'PER_UNIT', stat: 'score', points: 1 },
        { type: 'OUTCOME', win: 3, draw: 0, loss: 0 },
      ],
    });
    expect(scoringLines(cr, clash)).toEqual(['1 ponto por coroa', 'Vitória vale 3 pontos, empate 0 e derrota 0']);
  });

  it('eFootball 3/1/0', () => {
    const ef = model({ matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }] });
    expect(scoringSummary(ef, efootball)).toBe('Vitória vale 3 pontos, empate 1 e derrota 0');
  });

  it('sem saber o jogo, o placar fica genérico em vez de inventar um nome', () => {
    const generic = model({ matchType: 'DUEL', rules: [{ type: 'PER_UNIT', stat: 'score', points: 2 }] });
    expect(scoringSummary(generic)).toBe('2 pontos por ponto de placar');
    expect(scoringSummary(generic, { slug: 'jogo-novo', extraStatFields: [] })).toBe('2 pontos por ponto de placar');
  });

  it('uma frase por regra, na ordem do modelo', () => {
    const league = model({
      rules: [
        { type: 'PER_UNIT', stat: 'kills', points: 1 },
        { type: 'CAP', stat: 'kills', max: 15 },
        { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } },
      ],
    });
    const lines = scoringLines(league, freeFire);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('1 ponto por kill');
    expect(lines[2]).toBe('A última queda vale ×2');
  });
});

describe('defaultScoringModels', () => {
  it('só os modelos padrão do catálogo (não os personalizados de organizador)', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', isDefault: false }), model({ id: 'c', ownerId: 'u_camila' })];
    expect(defaultScoringModels({ scoringModels: models }).map((m) => m.id)).toEqual(['a']);
  });
});

describe('textos de modo de jogo', () => {
  it('tamanho da equipe e reservas', () => {
    expect(teamSizeText({ teamSize: 1, maxSubs: 0 })).toBe('Individual');
    expect(teamSizeText({ teamSize: 4, maxSubs: 1 })).toBe('Equipes de 4 jogadores + 1 reserva');
    expect(teamSizeText({ teamSize: 5, maxSubs: 2 })).toBe('Equipes de 5 jogadores + 2 reservas');
    expect(teamSizeText({ teamSize: 2, maxSubs: 0 })).toBe('Equipes de 2 jogadores, sem reservas');
  });

  it('tipo de partida, com o tamanho da sala no Battle Royale', () => {
    expect(matchTypeText({ matchType: 'DUEL', maxLobbySize: null, teamSize: 1 })).toBe('Duelo 1 contra 1');
    expect(matchTypeText({ matchType: 'TEAM_VS_TEAM', maxLobbySize: null, teamSize: 4 })).toBe('Equipe contra equipe');
    expect(matchTypeText({ matchType: 'BATTLE_ROYALE', maxLobbySize: 12, teamSize: 4 })).toBe('Battle Royale · até 12 equipes por sala');
    expect(matchTypeText({ matchType: 'BATTLE_ROYALE', maxLobbySize: 48, teamSize: 1 })).toBe('Battle Royale · até 48 jogadores por sala');
  });
});
