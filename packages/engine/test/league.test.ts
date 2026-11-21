import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError, computeLeagueTable, finalPlacements, leaguePointsFor, validateLeagueRule } from '../src/index';
import type { LeagueRule } from '../src/index';

const RULE: LeagueRule = { placementPoints: [10, 7, 5, 3, 1], participationPoints: 1 };

describe('validateLeagueRule', () => {
  it('aceita a regra padrão e explica cada erro em pt-BR', () => {
    expect(validateLeagueRule(RULE)).toEqual([]);
    expect(validateLeagueRule({ placementPoints: [], participationPoints: 0 })).toEqual(['Informe os pontos de pelo menos o 1º lugar.']);
    expect(validateLeagueRule({ placementPoints: [5, -1], participationPoints: 0 })).toContain('Os pontos por colocação precisam ser números inteiros a partir de 0.');
    expect(validateLeagueRule({ placementPoints: [5, 7], participationPoints: 0 })).toEqual(['Uma colocação não pode valer mais do que a anterior.']);
    expect(validateLeagueRule({ placementPoints: [5], participationPoints: 1.5 })).toEqual(['Os pontos de participação precisam ser um número inteiro a partir de 0.']);
  });
});

describe('leaguePointsFor', () => {
  it('soma a colocação e a participação; além da lista vale só a participação', () => {
    expect(leaguePointsFor(1, RULE)).toBe(11);
    expect(leaguePointsFor(5, RULE)).toBe(2);
    expect(leaguePointsFor(9, RULE)).toBe(1);
    expect(() => leaguePointsFor(0, RULE)).toThrow(EngineError);
  });
});

describe('finalPlacements', () => {
  it('última fase primeiro, depois quem parou antes; o pódio vem na frente', () => {
    const groups = ['a', 'b', 'c', 'd', 'e', 'f'];
    const final = ['c', 'a', 'b'];
    expect(finalPlacements([groups, final])).toEqual({ c: 1, a: 2, b: 3, d: 4, e: 5, f: 6 });
    expect(finalPlacements([groups, final], ['a', 'c'])).toEqual({ a: 1, c: 2, b: 3, d: 4, e: 5, f: 6 });
    expect(finalPlacements([])).toEqual({});
  });

  it('propriedade: cada inscrito recebe uma colocação única, de 1 a N', () => {
    fc.assert(
      fc.property(fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 20 }), { maxLength: 4 }), (stages) => {
        const orders = stages.map((s) => s.map((n) => `r${n}`));
        const placements = Object.values(finalPlacements(orders));
        const all = new Set(orders.flat());
        expect(placements.length).toBe(all.size);
        expect([...placements].sort((x, y) => x - y)).toEqual(Array.from({ length: all.size }, (_, i) => i + 1));
      }),
    );
  });
});

describe('computeLeagueTable', () => {
  it('soma os pontos dos campeonatos e desempata por títulos, melhor colocação e campeonatos jogados', () => {
    const table = computeLeagueTable(
      [
        { tournamentId: 't1', placements: [{ key: 'u:ana', name: 'Ana', placement: 1 }, { key: 'u:bia', name: 'Bia', placement: 2 }, { key: 'u:caio', name: 'Caio', placement: 3 }] },
        { tournamentId: 't2', placements: [{ key: 'u:bia', name: 'Bia', placement: 1 }, { key: 'u:ana', name: 'Ana', placement: 2 }, { key: 'u:davi', name: 'Davi', placement: 5 }] },
      ],
      RULE,
    );
    expect(table.map((r) => [r.key, r.points, r.position])).toEqual([
      ['u:ana', 19, 1],
      ['u:bia', 19, 1],
      ['u:caio', 6, 3],
      ['u:davi', 2, 4],
    ]);
    expect(table[0]?.results).toEqual([
      { tournamentId: 't1', placement: 1, points: 11 },
      { tournamentId: 't2', placement: 2, points: 8 },
    ]);
    expect(table[0]).toMatchObject({ wins: 1, played: 2, bestPlacement: 1 });
  });

  it('pontos iguais: mais títulos na frente; a mesma pessoa duas vezes no campeonato vale a melhor colocação', () => {
    const rule: LeagueRule = { placementPoints: [3, 3, 1], participationPoints: 0 };
    const table = computeLeagueTable(
      [
        { tournamentId: 't1', placements: [{ key: 'x', name: 'Xis', placement: 2 }, { key: 'y', name: 'Ípsilon', placement: 1 }, { key: 'x', name: 'Xis', placement: 3 }] },
        { tournamentId: 't2', placements: [{ key: 'z', name: 'Zeta', placement: 3 }] },
        { tournamentId: 't3', placements: [{ key: 'z', name: 'Zeta', placement: 3 }, { key: 'w', name: 'Wagner', placement: 3 }] },
      ],
      rule,
    );
    expect(table.map((r) => [r.key, r.points, r.position])).toEqual([
      ['y', 3, 1],
      ['x', 3, 2],
      ['z', 2, 3],
      ['w', 1, 4],
    ]);
    expect(table.find((r) => r.key === 'x')?.played).toBe(1);
  });

  it('propriedade: a soma dos pontos da tabela é a soma dos pontos de cada campeonato', () => {
    fc.assert(
      fc.property(fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 15 }), { minLength: 1, maxLength: 10 }), { maxLength: 5 }), (tournaments) => {
        const results = tournaments.map((ids, t) => ({ tournamentId: `t${t}`, placements: ids.map((id, i) => ({ key: `k${id}`, name: `N${id}`, placement: i + 1 })) }));
        const table = computeLeagueTable(results, RULE);
        const expected = results.flatMap((r) => r.placements).reduce((s, p) => s + leaguePointsFor(p.placement, RULE), 0);
        expect(table.reduce((s, r) => s + r.points, 0)).toBe(expected);
        table.forEach((row, i) => {
          if (i > 0) expect(row.points).toBeLessThanOrEqual((table[i - 1] as typeof row).points);
        });
      }),
    );
  });
});
