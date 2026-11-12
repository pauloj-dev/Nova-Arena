import type { ExtraStatField } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { needsTiebreak, scoreLine, scoreProblems, sidesOf, toResultInput, type Side } from './scoreForm';

const md3 = { bracket: 'WINNERS' as const, bestOf: 3 };
const knockout = { bracket: 'WINNERS' as const, bestOf: 1 };
const league = { bracket: null, bestOf: 1 };
const penalties: ExtraStatField = { key: 'penalties', label: 'Pênaltis', when: 'tiebreak' };
const sides: [Side, Side] = [
  { registrationId: 'r_a', name: 'Bianca' },
  { registrationId: 'r_b', name: 'Caio' },
];

describe('placar do duelo', () => {
  it('série melhor de 3: não empata e o vencedor tem exatamente 2', () => {
    expect(scoreProblems(md3, { a: 1, b: 1 }, undefined).b).toMatch(/não termina empatada/);
    expect(scoreProblems(md3, { a: 3, b: 1 }, undefined).b).toMatch(/exatamente 2 vitórias/);
    expect(scoreProblems(md3, { a: 1, b: 0 }, undefined).b).toMatch(/exatamente 2 vitórias/);
    expect(scoreProblems(md3, { a: 2, b: 1 }, undefined)).toEqual({});
    expect(scoreProblems(md3, { a: 0, b: 2 }, undefined)).toEqual({});
  });

  it('empate em mata-mata de jogo único pede desempate; em pontos corridos não', () => {
    expect(needsTiebreak(knockout, 1, 1)).toBe(true);
    expect(needsTiebreak(knockout, 2, 1)).toBe(false);
    expect(needsTiebreak(knockout, Number.NaN, Number.NaN)).toBe(false);
    expect(needsTiebreak(league, 1, 1)).toBe(false);
    expect(needsTiebreak(md3, 1, 1)).toBe(false);
    expect(scoreProblems(league, { a: 1, b: 1 }, undefined)).toEqual({});
  });

  it('desempate: campo do jogo (pênaltis) ou vencedor escolhido', () => {
    expect(scoreProblems(knockout, { a: 1, b: 1 }, penalties).tiebreakB).toMatch(/pênaltis dos dois lados/);
    expect(scoreProblems(knockout, { a: 1, b: 1, tiebreakA: 4, tiebreakB: 4 }, penalties).tiebreakB).toMatch(/não pode terminar empatado/);
    expect(scoreProblems(knockout, { a: 1, b: 1, tiebreakA: 5, tiebreakB: 4 }, penalties)).toEqual({});
    expect(scoreProblems(knockout, { a: 1, b: 1 }, undefined).winner).toBe('Escolha quem venceu o desempate.');
    expect(scoreProblems(knockout, { a: 1, b: 1, winner: 'r_b' }, undefined)).toEqual({});
  });

  it('converte o formulário em estatísticas brutas, sem pontos', () => {
    expect(toResultInput(md3, sides, { a: 2, b: 1 }, undefined)).toEqual({ entries: [{ registrationId: 'r_a', score: 2 }, { registrationId: 'r_b', score: 1 }] });
    expect(toResultInput(knockout, sides, { a: 1, b: 1, tiebreakA: 5, tiebreakB: 4 }, penalties)).toEqual({
      entries: [
        { registrationId: 'r_a', score: 1, stats: { penalties: 5 } },
        { registrationId: 'r_b', score: 1, stats: { penalties: 4 } },
      ],
    });
    expect(toResultInput(knockout, sides, { a: 0, b: 0, winner: 'r_b' }, undefined)).toEqual({ entries: [{ registrationId: 'r_a', score: 0 }, { registrationId: 'r_b', score: 0 }], winnerRegistrationId: 'r_b' });
    // Sem empate, desempate digitado antes é ignorado.
    expect(toResultInput(knockout, sides, { a: 2, b: 1, tiebreakA: 5, tiebreakB: 4, winner: 'r_b' }, penalties)).toEqual({ entries: [{ registrationId: 'r_a', score: 2 }, { registrationId: 'r_b', score: 1 }] });
  });

  it('texto do placar, com e sem os nomes', () => {
    const participants = [
      { registrationId: 'r_a', name: 'Bianca' },
      { registrationId: 'r_b', name: 'Caio' },
    ];
    const entries = [
      { registrationId: 'r_a', score: 2 },
      { registrationId: 'r_b', score: 1 },
    ];
    expect(scoreLine({ entries, winnerRegistrationId: 'r_a' }, { participants } as never)).toBe('Bianca 2 x 1 Caio');
    expect(scoreLine({ entries, winnerRegistrationId: 'r_a' }, undefined)).toBe('2 x 1');
    const tie = [
      { registrationId: 'r_a', score: 1 },
      { registrationId: 'r_b', score: 1 },
    ];
    expect(scoreLine({ entries: tie, winnerRegistrationId: 'r_b' }, { participants } as never)).toBe('Bianca 1 x 1 Caio (Caio venceu o desempate)');
    expect(scoreLine({ entries: tie, winnerRegistrationId: null }, { participants } as never)).toBe('Bianca 1 x 1 Caio');
  });

  it('lados: só com os dois participantes definidos', () => {
    expect(sidesOf({ participants: [{ registrationId: 'r_a', name: 'Bianca' }, { registrationId: null, name: 'A definir' }] } as never)).toBeNull();
    expect(sidesOf({ participants: [{ registrationId: 'r_a', name: 'Bianca' }, { registrationId: 'r_b', name: 'Caio' }] } as never)).toEqual(sides);
  });
});
