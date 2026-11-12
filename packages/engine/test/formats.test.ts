import { describe, expect, it } from 'vitest';
import { STAGE_FORMATS, generateStage, isStageComplete } from '../src/index';
import type { StageConfig, StageFormat, StageStructure } from '../src/index';
import { FIXED_SIZES, byId, makeEntrants, simulate, slotIds } from './helpers';

const gen = (format: StageFormat, n: number, config: StageConfig = {}): StageStructure =>
  generateStage({ format, entrants: makeEntrants(n), config, seeding: 'RANKED' });

const realDuels = (s: StageStructure) => s.matches.filter((m) => m.slots.length === 2);

describe.each(STAGE_FORMATS)('%s — casos fixos', (format) => {
  it.each(FIXED_SIZES)('%i participantes: estrutura válida, serializável e jogável até o fim', (n) => {
    const structure = gen(format, n);
    expect(structure.format).toBe(format);
    expect(structure.entrants.map((e) => e.id)).toEqual(makeEntrants(n).map((e) => e.id));
    expect(JSON.parse(JSON.stringify(structure))).toEqual(structure);
    expect(gen(format, n)).toEqual(structure);

    const ids = structure.matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Ninguém aparece duas vezes na mesma rodada (por lado da chave).
    const seen = new Set<string>();
    for (const match of structure.matches) {
      for (const id of slotIds(match)) {
        if (id === null) continue;
        const key = `${match.bracket}:${match.round}:${id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }

    // Todo participante está em alguma partida (ou avançou sem jogar).
    const placed = new Set(structure.matches.flatMap(slotIds));
    for (const entrant of structure.entrants) expect(placed.has(entrant.id)).toBe(true);

    const end = simulate(structure, `fixo-${format}-${n}`);
    expect(isStageComplete(end.structure, end.state)).toBe(true);
  });
});

describe('SINGLE_ELIM', () => {
  it.each(FIXED_SIZES)('%i participantes: N−1 partidas', (n) => {
    expect(gen('SINGLE_ELIM', n).matches).toHaveLength(n - 1);
  });

  it('8 participantes: 1x8, 4x5, 2x7, 3x6 e rótulos em pt-BR', () => {
    const s = gen('SINGLE_ELIM', 8);
    expect(s.rounds).toBe(3);
    expect(s.matches.map((m) => m.id)).toEqual(['w-r1-m1', 'w-r1-m2', 'w-r1-m3', 'w-r1-m4', 'w-r2-m1', 'w-r2-m2', 'w-r3-m1']);
    expect(s.matches.slice(0, 4).map(slotIds)).toEqual([
      ['p1', 'p8'],
      ['p4', 'p5'],
      ['p2', 'p7'],
      ['p3', 'p6'],
    ]);
    expect(s.matches.map((m) => m.roundLabel)).toEqual([
      'Quartas de final',
      'Quartas de final',
      'Quartas de final',
      'Quartas de final',
      'Semifinal',
      'Semifinal',
      'Final',
    ]);
    expect(byId(s, 'w-r1-m1')).toMatchObject({ nextMatchId: 'w-r2-m1', loserNextMatchId: null, bracket: 'WINNERS', kind: 'DUEL' });
    expect(byId(s, 'w-r2-m1').slots).toEqual([
      { entrantId: null, source: { matchId: 'w-r1-m1', outcome: 'winner' } },
      { entrantId: null, source: { matchId: 'w-r1-m2', outcome: 'winner' } },
    ]);
    expect(byId(s, 'w-r3-m1').nextMatchId).toBeNull();
  });

  it('CT-04: 5 participantes → byes para os seeds 1, 2 e 3; 4 partidas', () => {
    const s = gen('SINGLE_ELIM', 5);
    expect(s.matches).toHaveLength(4);
    const byes = s.matches.flatMap((m) => m.slots.filter((slot) => slot.isBye).map((slot) => slot.entrantId));
    expect(byes.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(s.matches.map((m) => m.id)).toEqual(['w-r1-m2', 'w-r2-m1', 'w-r2-m2', 'w-r3-m1']);
    expect(slotIds(byId(s, 'w-r1-m2'))).toEqual(['p4', 'p5']);
    expect(byId(s, 'w-r2-m1').slots).toEqual([
      { entrantId: 'p1', isBye: true },
      { entrantId: null, source: { matchId: 'w-r1-m2', outcome: 'winner' } },
    ]);
    expect(byId(s, 'w-r2-m2').slots).toEqual([
      { entrantId: 'p2', isBye: true },
      { entrantId: 'p3', isBye: true },
    ]);
  });

  it('2 e 3 participantes', () => {
    expect(gen('SINGLE_ELIM', 2).matches.map((m) => [m.id, m.roundLabel])).toEqual([['w-r1-m1', 'Final']]);
    const three = gen('SINGLE_ELIM', 3);
    expect(three.matches.map((m) => [m.id, m.roundLabel])).toEqual([
      ['w-r1-m2', 'Semifinal'],
      ['w-r2-m1', 'Final'],
    ]);
    expect(slotIds(byId(three, 'w-r2-m1'))).toEqual(['p1', null]);
  });

  it('64 participantes: 16 avos viram "Rodada 1", depois oitavas', () => {
    const s = gen('SINGLE_ELIM', 64);
    expect(s.rounds).toBe(6);
    expect(byId(s, 'w-r1-m1').roundLabel).toBe('Rodada 1');
    expect(byId(s, 'w-r2-m1').roundLabel).toBe('Rodada 2');
    expect(byId(s, 'w-r3-m1').roundLabel).toBe('Oitavas de final');
  });

  it('disputa de 3º lugar opcional (a partir de 4 participantes)', () => {
    const s = gen('SINGLE_ELIM', 8, { thirdPlace: true });
    expect(s.matches).toHaveLength(8);
    const third = byId(s, '3rd');
    expect(third).toMatchObject({ bracket: 'THIRD_PLACE', roundLabel: 'Disputa de 3º lugar', round: 3 });
    expect(third.slots).toEqual([
      { entrantId: null, source: { matchId: 'w-r2-m1', outcome: 'loser' } },
      { entrantId: null, source: { matchId: 'w-r2-m2', outcome: 'loser' } },
    ]);
    expect(byId(s, 'w-r2-m1').loserNextMatchId).toBe('3rd');
    expect(gen('SINGLE_ELIM', 3, { thirdPlace: true }).matches).toHaveLength(2);
    expect(gen('SINGLE_ELIM', 5, { thirdPlace: true }).matches).toHaveLength(5);
  });

  it('stopAtRemaining para a chave antes da final', () => {
    const s = gen('SINGLE_ELIM', 8, { stopAtRemaining: 2 });
    expect(s.rounds).toBe(2);
    expect(s.matches.map((m) => m.roundLabel)).toEqual([
      'Quartas de final',
      'Quartas de final',
      'Quartas de final',
      'Quartas de final',
      'Semifinal',
      'Semifinal',
    ]);
    expect(byId(s, 'w-r2-m1').nextMatchId).toBeNull();
    expect(() => gen('SINGLE_ELIM', 8, { stopAtRemaining: 3 })).toThrow('potência de 2');
    expect(() => gen('SINGLE_ELIM', 8, { stopAtRemaining: 8 })).toThrow('potência de 2');
  });

  it('valida a série', () => {
    expect(gen('SINGLE_ELIM', 4, { bestOf: 5 }).matches.every((m) => m.bestOf === 5)).toBe(true);
    expect(() => gen('SINGLE_ELIM', 4, { bestOf: 2 })).toThrow('melhor de 1, 3, 5 ou 7');
  });
});

describe('TEAM_VS_TEAM', () => {
  it('é uma eliminação simples entre equipes, de MD1 a MD7', () => {
    for (const bestOf of [1, 3, 5, 7]) {
      const s = gen('TEAM_VS_TEAM', 8, { bestOf });
      expect(s.format).toBe('TEAM_VS_TEAM');
      expect(s.matches).toHaveLength(7);
      expect(s.matches.every((m) => m.bestOf === bestOf && m.kind === 'DUEL')).toBe(true);
      expect(s.matches.map((m) => m.id)).toEqual(gen('SINGLE_ELIM', 8).matches.map((m) => m.id));
    }
    expect(() => gen('TEAM_VS_TEAM', 8, { bestOf: 9 })).toThrow('melhor de 1, 3, 5 ou 7');
  });
});

describe('DOUBLE_ELIM', () => {
  it.each(FIXED_SIZES)('%i participantes: 2N−2 partidas + reset', (n) => {
    expect(gen('DOUBLE_ELIM', n).matches).toHaveLength(2 * n - 1);
    expect(gen('DOUBLE_ELIM', n, { grandFinalReset: false }).matches).toHaveLength(2 * n - 2);
  });

  it('8 participantes: chave de perdedores e Grande Final', () => {
    const s = gen('DOUBLE_ELIM', 8);
    expect(s.rounds).toBe(3);
    const ids = (bracket: string) => s.matches.filter((m) => m.bracket === bracket).map((m) => m.id);
    expect(ids('WINNERS')).toEqual(['w-r1-m1', 'w-r1-m2', 'w-r1-m3', 'w-r1-m4', 'w-r2-m1', 'w-r2-m2', 'w-r3-m1']);
    expect(ids('LOSERS')).toEqual(['l-r1-m1', 'l-r1-m2', 'l-r2-m1', 'l-r2-m2', 'l-r3-m1', 'l-r4-m1']);
    expect(ids('FINAL')).toEqual(['gf-1', 'gf-2']);

    expect(byId(s, 'w-r1-m1')).toMatchObject({ nextMatchId: 'w-r2-m1', loserNextMatchId: 'l-r1-m1' });
    expect(byId(s, 'l-r1-m1').slots).toEqual([
      { entrantId: null, source: { matchId: 'w-r1-m1', outcome: 'loser' } },
      { entrantId: null, source: { matchId: 'w-r1-m2', outcome: 'loser' } },
    ]);
    // Quem cai da 2ª rodada de cima é cruzado para não reencontrar o adversário da 1ª.
    expect(byId(s, 'l-r2-m1').slots).toEqual([
      { entrantId: null, source: { matchId: 'w-r2-m2', outcome: 'loser' } },
      { entrantId: null, source: { matchId: 'l-r1-m1', outcome: 'winner' } },
    ]);
    expect(byId(s, 'gf-1').slots).toEqual([
      { entrantId: null, source: { matchId: 'w-r3-m1', outcome: 'winner' } },
      { entrantId: null, source: { matchId: 'l-r4-m1', outcome: 'winner' } },
    ]);
    expect(byId(s, 'gf-2')).toMatchObject({ ifNecessary: true, roundLabel: 'Grande Final (reset)' });
    expect(byId(s, 'gf-1').roundLabel).toBe('Grande Final');
    expect(byId(s, 'w-r3-m1').roundLabel).toBe('Final da chave superior');
    expect(byId(s, 'w-r2-m1').roundLabel).toBe('Semifinal da chave superior');
    expect(byId(s, 'w-r1-m1').roundLabel).toBe('Chave superior · Rodada 1');
    expect(byId(s, 'l-r1-m1').roundLabel).toBe('Chave inferior · Rodada 1');
    expect(byId(s, 'l-r4-m1').roundLabel).toBe('Final da chave inferior');
  });

  it('5 participantes: rodadas vazias da chave de perdedores somem', () => {
    const s = gen('DOUBLE_ELIM', 5, { grandFinalReset: false });
    expect(s.matches.map((m) => m.id)).toEqual(['w-r1-m2', 'w-r2-m1', 'w-r2-m2', 'w-r3-m1', 'l-r1-m1', 'l-r2-m1', 'l-r3-m1', 'gf-1']);
    expect(byId(s, 'w-r1-m2').loserNextMatchId).toBe('l-r1-m1');
    const byes = s.matches.flatMap((m) => m.slots.filter((slot) => slot.isBye).map((slot) => slot.entrantId));
    expect(byes.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('2 participantes: final de cima e Grande Final entre os mesmos dois', () => {
    const s = gen('DOUBLE_ELIM', 2);
    expect(s.matches.map((m) => m.id)).toEqual(['w-r1-m1', 'gf-1', 'gf-2']);
    expect(byId(s, 'w-r1-m1')).toMatchObject({ nextMatchId: 'gf-1', loserNextMatchId: 'gf-1' });
  });
});

describe('ROUND_ROBIN', () => {
  it.each(FIXED_SIZES)('%i participantes: todos contra todos uma vez', (n) => {
    const s = gen('ROUND_ROBIN', n);
    expect(s.matches).toHaveLength((n * (n - 1)) / 2);
    expect(s.rounds).toBe(n % 2 === 0 ? n - 1 : n);
    const pairs = new Set(s.matches.map((m) => slotIds(m).slice().sort().join('|')));
    expect(pairs.size).toBe(s.matches.length);
    // Com número ímpar, um participante folga em cada rodada.
    for (let round = 1; round <= s.rounds; round++) {
      const playing = s.matches.filter((m) => m.round === round).flatMap(slotIds);
      expect(playing).toHaveLength(n % 2 === 0 ? n : n - 1);
    }
  });

  it('4 participantes: método do círculo', () => {
    const s = gen('ROUND_ROBIN', 4);
    expect(s.matches.map((m) => [m.id, ...slotIds(m)])).toEqual([
      ['rr-r1-m1', 'p1', 'p4'],
      ['rr-r1-m2', 'p2', 'p3'],
      ['rr-r2-m1', 'p3', 'p1'],
      ['rr-r2-m2', 'p4', 'p2'],
      ['rr-r3-m1', 'p1', 'p2'],
      ['rr-r3-m2', 'p3', 'p4'],
    ]);
    expect(s.matches.every((m) => m.bracket === null && m.groupId === null)).toBe(true);
    expect(byId(s, 'rr-r2-m1').roundLabel).toBe('Rodada 2');
  });

  it('turno e returno inverte o mando', () => {
    const s = gen('ROUND_ROBIN', 5, { doubleRound: true });
    expect(s.matches).toHaveLength(20);
    expect(s.rounds).toBe(10);
    const first = s.matches.filter((m) => m.round <= 5).map((m) => slotIds(m).join('>'));
    const second = s.matches.filter((m) => m.round > 5).map((m) => slotIds(m).slice().reverse().join('>'));
    expect(second).toEqual(first);
  });
});

describe('GROUPS', () => {
  it('serpentina por potes: 8 em 2 grupos', () => {
    const s = gen('GROUPS', 8, { groupCount: 2 });
    expect(s.groups).toEqual([
      { id: 'g1', name: 'Grupo A', entrantIds: ['p1', 'p4', 'p5', 'p8'] },
      { id: 'g2', name: 'Grupo B', entrantIds: ['p2', 'p3', 'p6', 'p7'] },
    ]);
    expect(s.matches).toHaveLength(12);
    expect(s.matches.filter((m) => m.groupId === 'g1').map((m) => m.id)).toEqual([
      'g1-r1-m1',
      'g1-r1-m2',
      'g1-r2-m1',
      'g1-r2-m2',
      'g1-r3-m1',
      'g1-r3-m2',
    ]);
    expect(s.matches.map((m) => m.round)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  });

  it.each(FIXED_SIZES)('%i participantes: grupos diferem em no máximo 1', (n) => {
    const s = gen('GROUPS', n);
    const sizes = s.groups.map((g) => g.entrantIds.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
    for (const match of s.matches) {
      const group = s.groups.find((g) => g.id === match.groupId);
      for (const id of slotIds(match)) expect(group?.entrantIds).toContain(id);
    }
  });

  it('13 participantes em 4 grupos: 3, 3, 3, 4 (o último pote volta pela serpentina)', () => {
    const s = gen('GROUPS', 13);
    expect(s.groups.map((g) => g.entrantIds.length)).toEqual([3, 3, 3, 4]);
    expect(s.config.groupCount).toBe(4);
  });

  it('grupos em quedas BR: uma sala por grupo e queda', () => {
    const s = gen('GROUPS', 48, { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3 });
    expect(s.groups.map((g) => g.entrantIds.length)).toEqual([12, 12, 12, 12]);
    expect(s.matches).toHaveLength(12);
    expect(s.matches.map((m) => m.id).slice(0, 5)).toEqual(['g1-q1', 'g2-q1', 'g3-q1', 'g4-q1', 'g1-q2']);
    expect(byId(s, 'g3-q2')).toMatchObject({ kind: 'LOBBY', groupId: 'g3', dropIndex: 2, round: 2, roundLabel: 'Queda 2', multiplier: 1 });
    expect(byId(s, 'g3-q2').slots).toHaveLength(12);
    expect(s.rounds).toBe(3);
  });

  it('grupos BR sem configuração usam salas de até 12', () => {
    expect(gen('GROUPS', 64, { groupMode: 'BATTLE_ROYALE' }).groups).toHaveLength(6);
  });

  it('turno e returno dentro do grupo e nome de grupo depois do Z', () => {
    const s = gen('GROUPS', 64, { groupCount: 32, doubleRound: true });
    expect(s.matches).toHaveLength(64);
    expect(s.groups[25]?.name).toBe('Grupo Z');
    expect(s.groups[26]?.name).toBe('Grupo AA');
    expect(s.groups[27]?.name).toBe('Grupo AB');
  });

  it('recusa configuração inválida', () => {
    expect(() => gen('GROUPS', 8, { groupCount: 5 })).toThrow('ao menos 2 participantes');
    expect(() => gen('GROUPS', 8, { groupCount: 0 })).toThrow('número de grupos');
    expect(() => gen('GROUPS', 8, { groupSize: 1 })).toThrow('tamanho do grupo');
    expect(() => gen('GROUPS', 8, { groupMode: 'X' as never })).toThrow('Modo de grupo inválido.');
  });
});

describe('SWISS', () => {
  it('8 participantes: metade de cima contra a de baixo, 3 rodadas previstas', () => {
    const s = gen('SWISS', 8);
    expect(s.rounds).toBe(3);
    expect(s.matches.map((m) => [m.id, ...slotIds(m)])).toEqual([
      ['sw-r1-m1', 'p1', 'p5'],
      ['sw-r1-m2', 'p2', 'p6'],
      ['sw-r1-m3', 'p3', 'p7'],
      ['sw-r1-m4', 'p4', 'p8'],
    ]);
  });

  it('5 participantes: bye para o pior colocado', () => {
    const s = gen('SWISS', 5);
    expect(s.matches.map((m) => [m.id, ...slotIds(m)])).toEqual([
      ['sw-r1-m1', 'p1', 'p3'],
      ['sw-r1-m2', 'p2', 'p4'],
      ['sw-r1-bye', 'p5'],
    ]);
    expect(byId(s, 'sw-r1-bye').slots).toEqual([{ entrantId: 'p5', isBye: true }]);
  });

  it.each([
    [2, 1],
    [3, 2],
    [5, 3],
    [8, 3],
    [13, 4],
    [16, 4],
    [64, 6],
  ])('%i participantes: %i rodadas por padrão', (n, rounds) => {
    expect(gen('SWISS', n).rounds).toBe(rounds);
  });

  it('limita o número de rodadas', () => {
    expect(gen('SWISS', 8, { rounds: 7 }).rounds).toBe(7);
    expect(() => gen('SWISS', 8, { rounds: 8 })).toThrow('no máximo 7 rodadas');
    expect(() => gen('SWISS', 8, { rounds: 0 })).toThrow('número de rodadas');
  });
});

describe('BATTLE_ROYALE', () => {
  it('sala padrão de 12 (ADR-0001) e N quedas com multiplicador', () => {
    const s = gen('BATTLE_ROYALE', 13, { drops: 3, dropMultipliers: [1, 1, 2] });
    expect(s.config.lobbySize).toBe(12);
    expect(s.groups.map((g) => [g.id, g.name, g.entrantIds.length])).toEqual([
      ['s1', 'Sala 1', 7],
      ['s2', 'Sala 2', 6],
    ]);
    expect(s.matches.map((m) => m.id)).toEqual(['br-s1-q1', 'br-s2-q1', 'br-s1-q2', 'br-s2-q2', 'br-s1-q3', 'br-s2-q3']);
    expect(byId(s, 'br-s2-q3')).toMatchObject({
      kind: 'LOBBY',
      groupId: 's2',
      round: 3,
      position: 2,
      dropIndex: 3,
      multiplier: 2,
      roundLabel: 'Queda 3',
      bracket: null,
    });
    expect(s.rounds).toBe(3);
  });

  it.each(FIXED_SIZES)('%i participantes: salas nunca passam do tamanho máximo', (n) => {
    const s = gen('BATTLE_ROYALE', n, { lobbySize: 5 });
    const sizes = s.groups.map((g) => g.entrantIds.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(s.groups).toHaveLength(Math.ceil(n / 5));
  });

  it('repassa killsPerPlayer e recusa configuração inválida', () => {
    expect(gen('BATTLE_ROYALE', 4, { killsPerPlayer: true }).config.killsPerPlayer).toBe(true);
    expect(gen('BATTLE_ROYALE', 4).config.killsPerPlayer).toBe(false);
    expect(() => gen('BATTLE_ROYALE', 4, { lobbySize: 1 })).toThrow('tamanho da sala');
    expect(() => gen('BATTLE_ROYALE', 5, { lobbySize: 2 })).toThrow('precisa ser par');
    expect(() => gen('BATTLE_ROYALE', 4, { drops: 0 })).toThrow('número de quedas');
    expect(() => gen('BATTLE_ROYALE', 4, { dropMultipliers: [0] })).toThrow('multiplicadores');
    expect(() => gen('BATTLE_ROYALE', 4, { walkoverScore: -1 })).toThrow('placar de W.O.');
    expect(gen('BATTLE_ROYALE', 4, { walkoverScore: 2 }).config.walkoverScore).toBe(2);
  });
});

describe('quantidade de partidas reais por formato', () => {
  it('64 participantes', () => {
    expect(realDuels(gen('SINGLE_ELIM', 64))).toHaveLength(63);
    expect(realDuels(gen('DOUBLE_ELIM', 64))).toHaveLength(127);
    expect(realDuels(gen('ROUND_ROBIN', 64))).toHaveLength(2016);
    expect(realDuels(gen('SWISS', 64))).toHaveLength(32);
    expect(gen('GROUPS', 64).matches).toHaveLength(16 * 6);
    expect(gen('BATTLE_ROYALE', 64).matches).toHaveLength(6);
  });
});
