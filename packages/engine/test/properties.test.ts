import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STAGE_FORMATS, computeStandings, generateStage, isStageComplete } from '../src/index';
import type { MatchNode, StageConfig, StageFormat, StageStructure } from '../src/index';
import { makeEntrants, simulate, slotIds } from './helpers';

const size = fc.integer({ min: 2, max: 1024 });
/** Pontos corridos geram N·(N−1)/2 partidas: a propriedade roda até 96 e o caso de 1.024 fica no benchmark. */
const smallSize = fc.integer({ min: 2, max: 96 });
const seedText = fc.string({ minLength: 1, maxLength: 12 });
/**
 * Para as propriedades que jogam a fase inteira (milhares de `applyResult`): cobre 2 a 1.024,
 * mas sorteia mais chaves pequenas para o teste não demorar. Os extremos têm caso fixo abaixo.
 */
const playedSize = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 2, max: 128 }) },
  { weight: 1, arbitrary: fc.integer({ min: 129, max: 1024 }) },
);

const gen = (format: StageFormat, n: number, seed: string, config: StageConfig = {}): StageStructure =>
  generateStage({ format, entrants: makeEntrants(n), config, seeding: 'RANDOM', seed });

const sizeFor = (format: StageFormat) => (format === 'ROUND_ROBIN' ? smallSize : size);

function expectNoRepeatInRound(matches: readonly MatchNode[]): void {
  const seen = new Set<string>();
  for (const match of matches) {
    for (const id of slotIds(match)) {
      if (id === null) continue;
      const key = `${match.bracket}:${match.round}:${id}`;
      if (seen.has(key)) throw new Error(`${id} aparece duas vezes na rodada ${match.round} (${match.bracket})`);
      seen.add(key);
    }
  }
}

const byeIds = (structure: StageStructure): string[] =>
  structure.matches.flatMap((m) => m.slots.filter((slot) => slot.isBye).map((slot) => slot.entrantId as string));

describe('propriedades — todos os formatos', () => {
  it.each(STAGE_FORMATS)('%s: ninguém aparece duas vezes na mesma rodada; todos entram; mesma seed = mesma chave', (format) => {
    fc.assert(
      fc.property(sizeFor(format), seedText, (n, seed) => {
        const structure = gen(format, n, seed);
        expectNoRepeatInRound(structure.matches);
        const placed = new Set(structure.matches.flatMap(slotIds));
        expect(structure.entrants.every((entrant) => placed.has(entrant.id))).toBe(true);
        expect(structure.entrants).toHaveLength(n);
        expect(new Set(structure.matches.map((m) => m.id)).size).toBe(structure.matches.length);
        expect(gen(format, n, seed)).toEqual(structure);
        expect(structure.seedUsed).toBe(seed);
      }),
      { numRuns: format === 'ROUND_ROBIN' ? 30 : 60 },
    );
  });

  it('seeds diferentes embaralham de forma diferente', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 1024 }), (n) => {
        const a = gen('SINGLE_ELIM', n, 'seed-a').entrants.map((e) => e.id);
        const b = gen('SINGLE_ELIM', n, 'seed-b').entrants.map((e) => e.id);
        expect(a).not.toEqual(b);
        expect(a.slice().sort()).toEqual(b.slice().sort());
      }),
      { numRuns: 30 },
    );
  });
});

describe('propriedades — eliminação simples', () => {
  it('N−1 partidas sem 3º lugar; N com 3º lugar', () => {
    fc.assert(
      fc.property(size, seedText, (n, seed) => {
        expect(gen('SINGLE_ELIM', n, seed).matches).toHaveLength(n - 1);
        expect(gen('TEAM_VS_TEAM', n, seed).matches).toHaveLength(n - 1);
        if (n >= 4) expect(gen('SINGLE_ELIM', n, seed, { thirdPlace: true }).matches).toHaveLength(n);
      }),
      { numRuns: 60 },
    );
  });

  it('byes só para os melhores seeds', () => {
    fc.assert(
      fc.property(size, seedText, fc.constantFrom<StageFormat>('SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM'), (n, seed, format) => {
        const structure = gen(format, n, seed);
        let bracketSize = 1;
        while (bracketSize < n) bracketSize *= 2;
        const expected = structure.entrants.slice(0, bracketSize - n).map((e) => e.id);
        expect(byeIds(structure).sort()).toEqual(expected.sort());
      }),
      { numRuns: 80 },
    );
  });

  it('jogada até o fim: um campeão, todos os outros com exatamente 1 derrota', () => {
    fc.assert(
      fc.property(playedSize, seedText, (n, seed) => {
        const end = simulate(gen('SINGLE_ELIM', n, seed), seed);
        expect(isStageComplete(end.structure, end.state)).toBe(true);
        expectNoRepeatInRound(end.structure.matches);
        const losses = new Map<string, number>();
        for (const result of Object.values(end.state.results)) {
          losses.set(result.loserId as string, (losses.get(result.loserId as string) ?? 0) + 1);
        }
        expect(losses.size).toBe(n - 1);
        expect([...losses.values()].every((count) => count === 1)).toBe(true);
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});

describe('propriedades — eliminação dupla', () => {
  const lossesOf = (structure: StageStructure, seed: string) => {
    const end = simulate(structure, seed);
    const losses = new Map<string, number>(structure.entrants.map((e) => [e.id, 0]));
    for (const result of Object.values(end.state.results)) {
      losses.set(result.loserId as string, (losses.get(result.loserId as string) ?? 0) + 1);
    }
    return { end, losses };
  };

  const checkTwoLosses = (n: number, seed: string): void => {
        const structure = gen('DOUBLE_ELIM', n, seed);
        expect(structure.matches).toHaveLength(2 * n - 1);
        const { end, losses } = lossesOf(structure, seed);
        expect(isStageComplete(end.structure, end.state)).toBe(true);
        expectNoRepeatInRound(end.structure.matches);

        const standings = computeStandings(end.structure, end.state, { rules: [{ type: 'OUTCOME', win: 1, draw: 0, loss: 0 }] });
        const champions = standings.overall.filter((row) => !row.eliminated);
        expect(champions).toHaveLength(1);
        expect(standings.overall[0]?.entrantId).toBe(champions[0]?.entrantId);
        for (const row of standings.overall) {
          const count = losses.get(row.entrantId) as number;
          if (row.eliminated) expect(count).toBe(2);
          else expect(count).toBeLessThanOrEqual(1);
        }
  };

  it('ninguém é eliminado com menos de 2 derrotas (com reset da Grande Final)', () => {
    fc.assert(fc.property(playedSize, seedText, checkTwoLosses), { numRuns: 30 });
  }, 120_000);

  it.each([1024, 1023, 513])('%i participantes: ninguém é eliminado com menos de 2 derrotas', (n) => {
    checkTwoLosses(n, `fixo-${n}`);
  }, 60_000);

  it('sem reset: só o vice pode sair com 1 derrota', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 256 }), seedText, (n, seed) => {
        const structure = gen('DOUBLE_ELIM', n, seed, { grandFinalReset: false });
        expect(structure.matches).toHaveLength(2 * n - 2);
        const { end, losses } = lossesOf(structure, seed);
        const final = end.state.results['gf-1'];
        for (const [id, count] of losses) {
          if (id === final?.winnerId) expect(count).toBeLessThanOrEqual(1);
          else if (id === final?.loserId) expect(count).toBeGreaterThanOrEqual(1);
          else expect(count).toBe(2);
        }
      }),
      { numRuns: 20 },
    );
  }, 60_000);
});

describe('propriedades — suíço', () => {
  const checkSwiss = (n: number, seed: string): void => {
        const structure = gen('SWISS', n, seed);
        const score = new Map<string, number>(structure.entrants.map((e) => [e.id, 0]));
        const hadBye = new Set<string>();
        const end = simulate(structure, seed, undefined, true);
        expect(isStageComplete(end.structure, end.state)).toBe(true);
        expectNoRepeatInRound(end.structure.matches);

        const pairs = new Set<string>();
        for (let round = 1; round <= end.structure.rounds; round++) {
          const matches = end.structure.matches.filter((m) => m.round === round);
          expect(matches.flatMap(slotIds)).toHaveLength(n);
          const byes = matches.filter((m) => m.slots.length === 1);
          expect(byes).toHaveLength(n % 2);
          for (const bye of byes) {
            const id = bye.slots[0]?.entrantId as string;
            expect(hadBye.has(id)).toBe(false);
            if (round === 1) expect(id).toBe(structure.entrants[n - 1]?.id);
            const eligible = [...score.entries()].filter(([other]) => !hadBye.has(other)).map(([, value]) => value);
            expect(score.get(id)).toBe(Math.min(...eligible));
            hadBye.add(id);
          }
          for (const match of matches) {
            const [a, b] = slotIds(match) as [string, string | undefined];
            if (b === undefined) {
              score.set(a, (score.get(a) as number) + 1);
              continue;
            }
            const key = [a, b].sort().join('|');
            expect(pairs.has(key)).toBe(false);
            pairs.add(key);
            const result = end.state.results[match.id];
            if (result?.draw) {
              score.set(a, (score.get(a) as number) + 0.5);
              score.set(b, (score.get(b) as number) + 0.5);
            } else {
              const winner = result?.winnerId as string;
              score.set(winner, (score.get(winner) as number) + 1);
            }
          }
        }
  };

  it('sem confronto repetido; bye para o pior colocado, nunca duas vezes para o mesmo', () => {
    fc.assert(fc.property(playedSize, seedText, checkSwiss), { numRuns: 30 });
  }, 120_000);

  it.each([1024, 1023])('%i participantes: 10 rodadas sem confronto repetido', (n) => {
    checkSwiss(n, `fixo-${n}`);
  }, 60_000);

  it('poucos participantes e o máximo de rodadas: ainda sem repetir', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), seedText, (n, seed) => {
        const rounds = Math.max(1, Math.floor(n / 2));
        const end = simulate(gen('SWISS', n, seed, { rounds }), seed);
        const keys = end.structure.matches.filter((m) => m.slots.length === 2).map((m) => slotIds(m).slice().sort().join('|'));
        expect(new Set(keys).size).toBe(keys.length);
        expect(end.structure.matches.reduce((max, m) => Math.max(max, m.round), 0)).toBe(rounds);
      }),
      { numRuns: 60 },
    );
  });
});

describe('propriedades — grupos, pontos corridos e Battle Royale', () => {
  it('grupos diferem em no máximo 1 participante', () => {
    fc.assert(
      fc.property(size, fc.integer({ min: 1, max: 64 }), seedText, fc.boolean(), (n, wanted, seed, lobby) => {
        const groupCount = Math.max(1, Math.min(wanted, Math.floor(n / 2)));
        const structure = gen('GROUPS', n, seed, { groupCount, groupMode: lobby ? 'BATTLE_ROYALE' : 'ROUND_ROBIN' });
        const sizes = structure.groups.map((g) => g.entrantIds.length);
        expect(structure.groups).toHaveLength(groupCount);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        expect(new Set(structure.groups.flatMap((g) => g.entrantIds)).size).toBe(n);
        // Serpentina: o seed k do pote p cai em grupos alternados.
        expect(structure.groups.map((g) => g.entrantIds[0])).toEqual(structure.entrants.slice(0, groupCount).map((e) => e.id));
      }),
      { numRuns: 60 },
    );
  });

  it('pontos corridos: cada par se enfrenta exatamente uma vez (duas no returno)', () => {
    fc.assert(
      fc.property(smallSize, seedText, fc.boolean(), (n, seed, doubleRound) => {
        const structure = gen('ROUND_ROBIN', n, seed, { doubleRound });
        const times = doubleRound ? 2 : 1;
        expect(structure.matches).toHaveLength((times * n * (n - 1)) / 2);
        const count = new Map<string, number>();
        for (const match of structure.matches) {
          const key = slotIds(match).slice().sort().join('|');
          count.set(key, (count.get(key) ?? 0) + 1);
        }
        expect(count.size).toBe((n * (n - 1)) / 2);
        expect([...count.values()].every((value) => value === times)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('Battle Royale: salas dentro do tamanho máximo e equilibradas', () => {
    fc.assert(
      fc.property(size, fc.integer({ min: 3, max: 60 }), fc.integer({ min: 1, max: 6 }), seedText, (n, lobbySize, drops, seed) => {
        const structure = gen('BATTLE_ROYALE', n, seed, { lobbySize, drops });
        const sizes = structure.groups.map((g) => g.entrantIds.length);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(lobbySize);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(structure.groups).toHaveLength(Math.ceil(n / lobbySize));
        expect(structure.matches).toHaveLength(structure.groups.length * drops);
      }),
      { numRuns: 60 },
    );
  });

  it('tabela: posições de 1 a N e pontos em ordem decrescente', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), seedText, fc.constantFrom<StageFormat>('ROUND_ROBIN', 'BATTLE_ROYALE', 'SWISS'), (n, seed, format) => {
        const end = simulate(gen(format, n, seed, { drops: 3 }), seed, undefined, true);
        const rules =
          format === 'BATTLE_ROYALE'
            ? [{ type: 'PER_UNIT' as const, stat: 'kills', points: 1 }, { type: 'TABLE' as const, stat: 'placement', table: { '1': 3 } }]
            : [{ type: 'OUTCOME' as const, win: 3, draw: 1, loss: 0 }];
        const first = computeStandings(end.structure, end.state, { rules });
        expect(computeStandings(end.structure, end.state, { rules })).toEqual(first);
        expect(first.overall.map((row) => row.position)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        const points = first.overall.map((row) => row.points);
        expect(points).toEqual(points.slice().sort((a, b) => b - a));
        expect(new Set(first.overall.map((row) => row.entrantId)).size).toBe(n);
      }),
      { numRuns: 40 },
    );
  });
});
