import { describe, expect, it } from 'vitest';
import {
  EngineError,
  applyResult,
  applyWalkover,
  createStageState,
  generateStage,
  generateSwissRound,
  getMatchStatus,
  isEliminationFormat,
  isStageComplete,
  swapEntrants,
  withdrawEntrant,
} from '../src/index';
import type { StageConfig, StageFormat, StageSnapshot, StageStructure } from '../src/index';
import { byId, makeEntrants, simulate, slotIds, start, win } from './helpers';

const gen = (format: StageFormat, n: number, config: StageConfig = {}): StageStructure =>
  generateStage({ format, entrants: makeEntrants(n), config, seeding: 'RANKED' });

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return 'OK';
};

describe('applyResult — duelos', () => {
  it('propaga o vencedor e não altera a entrada', () => {
    const structure = gen('SINGLE_ELIM', 4);
    const state = createStageState();
    const frozen = JSON.stringify({ structure, state });
    const next = applyResult(structure, state, {
      matchId: 'w-r1-m1',
      entries: [
        { entrantId: 'p1', score: 2 },
        { entrantId: 'p4', score: 1 },
      ],
    });
    expect(JSON.stringify({ structure, state })).toBe(frozen);
    expect(next.state.results['w-r1-m1']).toEqual({
      matchId: 'w-r1-m1',
      entries: [
        { entrantId: 'p1', score: 2 },
        { entrantId: 'p4', score: 1 },
      ],
      winnerId: 'p1',
      loserId: 'p4',
      draw: false,
      walkover: false,
      voided: false,
    });
    expect(slotIds(byId(next.structure, 'w-r2-m1'))).toEqual(['p1', null]);
    expect(getMatchStatus(next.structure, next.state, 'w-r1-m1')).toBe('COMPLETED');
    expect(getMatchStatus(next.structure, next.state, 'w-r1-m2')).toBe('READY');
    expect(getMatchStatus(next.structure, next.state, 'w-r2-m1')).toBe('PENDING');
    expect(isStageComplete(next.structure, next.state)).toBe(false);
  });

  it('disputa de 3º lugar recebe os perdedores das semifinais', () => {
    let snap = start(gen('SINGLE_ELIM', 4, { thirdPlace: true }));
    snap = win(snap, 'w-r1-m1', 'p1');
    snap = win(snap, 'w-r1-m2', 'p2');
    expect(slotIds(byId(snap.structure, '3rd'))).toEqual(['p4', 'p3']);
    expect(slotIds(byId(snap.structure, 'w-r2-m1'))).toEqual(['p1', 'p2']);
    snap = win(snap, '3rd', 'p3');
    snap = win(snap, 'w-r2-m1', 'p2');
    expect(isStageComplete(snap.structure, snap.state)).toBe(true);
  });

  it('aceita vencedor explícito com placar empatado (pênaltis, RN-14)', () => {
    const snap = applyResult(gen('SINGLE_ELIM', 2), createStageState(), {
      matchId: 'w-r1-m1',
      winnerId: 'p2',
      entries: [
        { entrantId: 'p1', score: 1, stats: { penalties: 3 } },
        { entrantId: 'p2', score: 1, stats: { penalties: 4 } },
      ],
    });
    expect(snap.state.results['w-r1-m1']).toMatchObject({ winnerId: 'p2', loserId: 'p1', draw: false });
    expect(snap.state.results['w-r1-m1']?.entries[1]?.stats).toEqual({ penalties: 4 });
  });

  it('aceita só o vencedor, sem placar', () => {
    const snap = applyResult(gen('SINGLE_ELIM', 2), createStageState(), { matchId: 'w-r1-m1', winnerId: 'p1', entries: [] });
    expect(snap.state.results['w-r1-m1']).toMatchObject({ winnerId: 'p1', entries: [{ entrantId: 'p1' }, { entrantId: 'p2' }] });
  });

  it('empate vale em pontos corridos e é recusado em mata-mata', () => {
    const rr = applyResult(gen('ROUND_ROBIN', 4), createStageState(), {
      matchId: 'rr-r1-m1',
      entries: [
        { entrantId: 'p1', score: 2 },
        { entrantId: 'p4', score: 2 },
      ],
    });
    expect(rr.state.results['rr-r1-m1']).toMatchObject({ draw: true, winnerId: null, loserId: null });
    const explicit = applyResult(gen('ROUND_ROBIN', 4), createStageState(), { matchId: 'rr-r1-m1', winnerId: null, entries: [] });
    expect(explicit.state.results['rr-r1-m1']?.draw).toBe(true);

    const tie = [
      { entrantId: 'p1', score: 1 },
      { entrantId: 'p4', score: 1 },
    ];
    expect(code(() => applyResult(gen('SINGLE_ELIM', 4), createStageState(), { matchId: 'w-r1-m1', entries: tie }))).toBe(
      'DRAW_NOT_ALLOWED',
    );
    expect(
      code(() => applyResult(gen('ROUND_ROBIN', 4, { bestOf: 3 }), createStageState(), { matchId: 'rr-r1-m1', entries: tie })),
    ).toBe('DRAW_NOT_ALLOWED');
  });

  it('valida a série melhor de N', () => {
    const structure = gen('TEAM_VS_TEAM', 4, { bestOf: 3 });
    const apply = (a: number, b: number) =>
      code(() =>
        applyResult(structure, createStageState(), {
          matchId: 'w-r1-m1',
          entries: [
            { entrantId: 'p1', score: a },
            { entrantId: 'p4', score: b },
          ],
        }),
      );
    expect(apply(2, 1)).toBe('OK');
    expect(apply(0, 2)).toBe('OK');
    expect(apply(3, 1)).toBe('INVALID_RESULT');
    expect(apply(1, 0)).toBe('INVALID_RESULT');
  });

  it('recusa resultados inválidos', () => {
    const structure = gen('SINGLE_ELIM', 4);
    const state = createStageState();
    const apply = (input: Parameters<typeof applyResult>[2]) => code(() => applyResult(structure, state, input));
    expect(apply({ matchId: 'nada', entries: [] })).toBe('MATCH_NOT_FOUND');
    expect(apply({ matchId: 'w-r2-m1', winnerId: 'p1', entries: [] })).toBe('MATCH_NOT_READY');
    expect(apply({ matchId: 'w-r1-m1', entries: [] })).toBe('INVALID_RESULT');
    expect(apply({ matchId: 'w-r1-m1', entries: [{ entrantId: 'p1', score: 1 }] })).toBe('INVALID_RESULT');
    expect(apply({ matchId: 'w-r1-m1', winnerId: 'p9', entries: [] })).toBe('INVALID_RESULT');
    expect(apply({ matchId: 'w-r1-m1', winnerId: 'p1', entries: [{ entrantId: 'p9', score: 1 }] })).toBe('INVALID_RESULT');
    expect(apply({ matchId: 'w-r1-m1', winnerId: 'p1', entries: [{ entrantId: 'p1', score: -1 }] })).toBe('INVALID_RESULT');
    expect(apply({ matchId: 'w-r1-m1', entries: undefined as never })).toBe('INVALID_RESULT');
    expect(
      apply({
        matchId: 'w-r1-m1',
        winnerId: 'p1',
        entries: [
          { entrantId: 'p1', score: 1 },
          { entrantId: 'p1', score: 2 },
        ],
      }),
    ).toBe('INVALID_RESULT');
    expect(
      apply({
        matchId: 'w-r1-m1',
        winnerId: 'p1',
        entries: [
          { entrantId: 'p1', score: 0 },
          { entrantId: 'p4', score: 2 },
        ],
      }),
    ).toBe('INVALID_RESULT');
    expect(
      code(() =>
        applyResult(gen('ROUND_ROBIN', 4), state, {
          matchId: 'rr-r1-m1',
          winnerId: null,
          entries: [
            { entrantId: 'p1', score: 2 },
            { entrantId: 'p4', score: 1 },
          ],
        }),
      ),
    ).toBe('INVALID_RESULT');
  });

  it('corrige um resultado enquanto a partida seguinte não foi concluída', () => {
    let snap = start(gen('SINGLE_ELIM', 4));
    snap = win(snap, 'w-r1-m1', 'p1');
    snap = win(snap, 'w-r1-m1', 'p4');
    expect(slotIds(byId(snap.structure, 'w-r2-m1'))).toEqual(['p4', null]);
    snap = win(snap, 'w-r1-m2', 'p2');
    snap = win(snap, 'w-r2-m1', 'p2');
    expect(code(() => win(snap, 'w-r1-m1', 'p1'))).toBe('RESULT_LOCKED');
    expect(code(() => win(snap, 'w-r2-m1', 'p4'))).toBe('OK');
  });
});

describe('applyResult — eliminação dupla', () => {
  it('perdedor cai para a chave de baixo', () => {
    let snap = start(gen('DOUBLE_ELIM', 4));
    snap = win(snap, 'w-r1-m1', 'p1');
    snap = win(snap, 'w-r1-m2', 'p2');
    expect(slotIds(byId(snap.structure, 'l-r1-m1'))).toEqual(['p4', 'p3']);
    snap = win(snap, 'w-r2-m1', 'p1');
    snap = win(snap, 'l-r1-m1', 'p3');
    expect(slotIds(byId(snap.structure, 'l-r2-m1'))).toEqual(['p2', 'p3']);
    snap = win(snap, 'l-r2-m1', 'p2');
    expect(slotIds(byId(snap.structure, 'gf-1'))).toEqual(['p1', 'p2']);
  });

  const untilGrandFinal = (): StageSnapshot => {
    let snap = start(gen('DOUBLE_ELIM', 2));
    snap = win(snap, 'w-r1-m1', 'p1');
    expect(slotIds(byId(snap.structure, 'gf-1'))).toEqual(['p1', 'p2']);
    return snap;
  };

  it('campeão da chave de cima vence a Grande Final: não há reset', () => {
    const snap = win(untilGrandFinal(), 'gf-1', 'p1');
    expect(snap.state.skipped).toEqual(['gf-2']);
    expect(getMatchStatus(snap.structure, snap.state, 'gf-2')).toBe('SKIPPED');
    expect(slotIds(byId(snap.structure, 'gf-2'))).toEqual([null, null]);
    expect(isStageComplete(snap.structure, snap.state)).toBe(true);
  });

  it('campeão da chave de baixo vence: joga-se o reset', () => {
    let snap = win(untilGrandFinal(), 'gf-1', 'p2');
    expect(snap.state.skipped).toEqual([]);
    expect(slotIds(byId(snap.structure, 'gf-2'))).toEqual(['p2', 'p1']);
    expect(isStageComplete(snap.structure, snap.state)).toBe(false);
    snap = win(snap, 'gf-2', 'p1');
    expect(isStageComplete(snap.structure, snap.state)).toBe(true);
  });

  it('corrigir a Grande Final liga e desliga o reset', () => {
    let snap = win(untilGrandFinal(), 'gf-1', 'p1');
    snap = win(snap, 'gf-1', 'p2');
    expect(snap.state.skipped).toEqual([]);
    expect(slotIds(byId(snap.structure, 'gf-2'))).toEqual(['p2', 'p1']);
    snap = win(snap, 'gf-1', 'p1');
    expect(snap.state.skipped).toEqual(['gf-2']);
    expect(code(() => applyResult(snap.structure, snap.state, { matchId: 'gf-2', winnerId: 'p1', entries: [] }))).toBe(
      'MATCH_NOT_READY',
    );
  });
});

describe('applyResult — Battle Royale', () => {
  const structure = gen('BATTLE_ROYALE', 4, { drops: 2 });
  const entries = [
    { entrantId: 'p1', placement: 2, kills: 5 },
    { entrantId: 'p2', placement: 1, kills: 3 },
    { entrantId: 'p3', placement: 3 },
    { entrantId: 'p4', placement: 4, kills: 0, stats: { damage: 900 } },
  ];

  it('registra colocação e kills; o Booyah é o vencedor', () => {
    const snap = applyResult(structure, createStageState(), { matchId: 'br-s1-q1', entries });
    expect(snap.structure).toBe(structure);
    expect(snap.state.results['br-s1-q1']).toMatchObject({ winnerId: 'p2', loserId: null, draw: false });
    expect(snap.state.results['br-s1-q1']?.entries[2]).toEqual({ entrantId: 'p3', placement: 3, kills: 0 });
    expect(snap.state.results['br-s1-q1']?.entries[3]?.stats).toEqual({ damage: 900 });
    expect(getMatchStatus(snap.structure, snap.state, 'br-s1-q2')).toBe('READY');
  });

  it('equipe ausente não precisa de colocação', () => {
    const snap = applyResult(structure, createStageState(), {
      matchId: 'br-s1-q1',
      entries: [...entries.slice(0, 3), { entrantId: 'p4', absent: true }],
    });
    expect(snap.state.results['br-s1-q1']?.entries[3]).toEqual({ entrantId: 'p4', absent: true, kills: 0 });
  });

  it('recusa colocação repetida, fora da faixa, equipe de fora ou faltando', () => {
    const apply = (list: typeof entries) => code(() => applyResult(structure, createStageState(), { matchId: 'br-s1-q1', entries: list }));
    expect(apply([{ ...entries[0]!, placement: 1 }, ...entries.slice(1)])).toBe('INVALID_RESULT');
    expect(apply([{ ...entries[0]!, placement: 5 }, ...entries.slice(1)])).toBe('INVALID_RESULT');
    expect(apply([{ ...entries[0]!, kills: -1 }, ...entries.slice(1)])).toBe('INVALID_RESULT');
    expect(apply([{ ...entries[0]!, kills: 1.5 }, ...entries.slice(1)])).toBe('INVALID_RESULT');
    expect(apply([...entries, { entrantId: 'p9', placement: 4, kills: 0 }])).toBe('INVALID_RESULT');
    expect(apply([...entries.slice(0, 3), entries[0]!])).toBe('INVALID_RESULT');
    expect(apply(entries.slice(0, 3))).toBe('INVALID_RESULT');
  });

  it('não há W.O. de sala', () => {
    expect(code(() => applyWalkover(structure, createStageState(), { matchId: 'br-s1-q1', winnerId: 'p1' }))).toBe('INVALID_RESULT');
  });
});

describe('applyWalkover (RN-04)', () => {
  it('série: o vencedor leva as vitórias necessárias', () => {
    const snap = applyWalkover(gen('TEAM_VS_TEAM', 4, { bestOf: 5 }), createStageState(), { matchId: 'w-r1-m1', winnerId: 'p4' });
    expect(snap.state.results['w-r1-m1']).toMatchObject({
      winnerId: 'p4',
      loserId: 'p1',
      walkover: true,
      entries: [
        { entrantId: 'p1', score: 0 },
        { entrantId: 'p4', score: 3 },
      ],
    });
    expect(slotIds(byId(snap.structure, 'w-r2-m1'))).toEqual(['p4', null]);
  });

  it('jogo único: placar configurado (padrão 3×0)', () => {
    const standard = applyWalkover(gen('ROUND_ROBIN', 4), createStageState(), { matchId: 'rr-r1-m1', winnerId: 'p1' });
    expect(standard.state.results['rr-r1-m1']?.entries.map((e) => e.score)).toEqual([3, 0]);
    const crowns = applyWalkover(gen('ROUND_ROBIN', 4, { walkoverScore: 2 }), createStageState(), {
      matchId: 'rr-r1-m1',
      winnerId: 'p4',
    });
    expect(crowns.state.results['rr-r1-m1']?.entries.map((e) => e.score)).toEqual([0, 2]);
  });

  it('recusa partida sem participantes ou vencedor de fora', () => {
    const structure = gen('SINGLE_ELIM', 4);
    expect(code(() => applyWalkover(structure, createStageState(), { matchId: 'w-r2-m1', winnerId: 'p1' }))).toBe('MATCH_NOT_READY');
    expect(code(() => applyWalkover(structure, createStageState(), { matchId: 'w-r1-m1', winnerId: 'p2' }))).toBe('INVALID_RESULT');
    expect(code(() => applyWalkover(structure, createStageState(), { matchId: 'x', winnerId: 'p2' }))).toBe('MATCH_NOT_FOUND');
  });
});

describe('swapEntrants', () => {
  it('troca os dois em todas as partidas e nas seeds', () => {
    const structure = gen('SINGLE_ELIM', 8);
    const swapped = swapEntrants(structure, 'p1', 'p5');
    expect(slotIds(byId(swapped, 'w-r1-m1'))).toEqual(['p5', 'p8']);
    expect(slotIds(byId(swapped, 'w-r1-m2'))).toEqual(['p4', 'p1']);
    expect(swapped.entrants.map((e) => [e.id, e.seed]).slice(0, 5)).toEqual([
      ['p5', 1],
      ['p2', 2],
      ['p3', 3],
      ['p4', 4],
      ['p1', 5],
    ]);
    expect(slotIds(byId(structure, 'w-r1-m1'))).toEqual(['p1', 'p8']);
    expect(swapEntrants(swapped, 'p5', 'p1').matches).toEqual(structure.matches);
  });

  it('troca entre grupos', () => {
    const swapped = swapEntrants(gen('GROUPS', 8, { groupCount: 2 }), 'p1', 'p2');
    expect(swapped.groups.map((g) => g.entrantIds)).toEqual([
      ['p2', 'p4', 'p5', 'p8'],
      ['p1', 'p3', 'p6', 'p7'],
    ]);
    for (const match of swapped.matches) {
      const group = swapped.groups.find((g) => g.id === match.groupId);
      for (const id of slotIds(match)) expect(group?.entrantIds).toContain(id);
    }
  });

  it('mantém o bye na vaga', () => {
    const swapped = swapEntrants(gen('SINGLE_ELIM', 5), 'p1', 'p5');
    expect(byId(swapped, 'w-r2-m1').slots[0]).toEqual({ entrantId: 'p5', isBye: true });
    expect(slotIds(byId(swapped, 'w-r1-m2'))).toEqual(['p4', 'p1']);
  });

  it('recusa troca inválida ou com a fase iniciada (RN-07)', () => {
    const structure = gen('SINGLE_ELIM', 4);
    expect(code(() => swapEntrants(structure, 'p1', 'p9'))).toBe('ENTRANT_NOT_FOUND');
    expect(code(() => swapEntrants(structure, 'p1', 'p1'))).toBe('INVALID_ENTRANTS');
    expect(code(() => swapEntrants(structure, 'p1', 'p2', createStageState()))).toBe('OK');
    const started = win(start(structure), 'w-r1-m1', 'p1');
    expect(code(() => swapEntrants(started.structure, 'p2', 'p3', started.state))).toBe('STAGE_STARTED');
  });
});

describe('generateSwissRound', () => {
  it('pareia por pontuação, sem repetir confronto', () => {
    let snap = start(gen('SWISS', 8));
    for (const [matchId, winner] of [
      ['sw-r1-m1', 'p1'],
      ['sw-r1-m2', 'p2'],
      ['sw-r1-m3', 'p7'],
      ['sw-r1-m4', 'p8'],
    ] as const) {
      snap = win(snap, matchId, winner);
    }
    const round2 = generateSwissRound(snap.structure, snap.state);
    expect(round2.matches.filter((m) => m.round === 2).map((m) => [m.id, m.roundLabel, ...slotIds(m)])).toEqual([
      ['sw-r2-m1', 'Rodada 2', 'p1', 'p2'],
      ['sw-r2-m2', 'Rodada 2', 'p7', 'p8'],
      ['sw-r2-m3', 'Rodada 2', 'p3', 'p4'],
      ['sw-r2-m4', 'Rodada 2', 'p5', 'p6'],
    ]);
    expect(snap.structure.matches).toHaveLength(4);
  });

  it('evita a revanche mesmo entre vizinhos de pontuação', () => {
    let snap = start(gen('SWISS', 4, { rounds: 3 }));
    snap = win(snap, 'sw-r1-m1', 'p1');
    snap = win(snap, 'sw-r1-m2', 'p2');
    snap = { structure: generateSwissRound(snap.structure, snap.state), state: snap.state };
    snap = win(snap, 'sw-r2-m1', 'p1');
    snap = win(snap, 'sw-r2-m2', 'p3');
    const round3 = generateSwissRound(snap.structure, snap.state);
    expect(round3.matches.filter((m) => m.round === 3).map(slotIds)).toEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
    ]);
  });

  it('ímpar: bye para o pior colocado que ainda não folgou', () => {
    let snap = start(gen('SWISS', 5));
    snap = win(snap, 'sw-r1-m1', 'p1');
    snap = win(snap, 'sw-r1-m2', 'p2');
    const round2 = generateSwissRound(snap.structure, snap.state);
    // p5 folgou na rodada 1 (1 ponto). Os piores são p3 e p4 (0 ponto): o bye vai para p4.
    expect(slotIds(byId(round2, 'sw-r2-bye'))).toEqual(['p4']);
    expect(round2.matches.filter((m) => m.round === 2 && m.slots.length === 2).map(slotIds)).toEqual([
      ['p1', 'p2'],
      ['p5', 'p3'],
    ]);
  });

  it('empate vale meio ponto no pareamento', () => {
    let snap = start(gen('SWISS', 4));
    snap = applyResult(snap.structure, snap.state, { matchId: 'sw-r1-m1', winnerId: null, entries: [] });
    snap = win(snap, 'sw-r1-m2', 'p4');
    const round2 = generateSwissRound(snap.structure, snap.state);
    expect(round2.matches.filter((m) => m.round === 2).map(slotIds)).toEqual([
      ['p4', 'p1'],
      ['p3', 'p2'],
    ]);
  });

  it('exige a rodada concluída e respeita o total de rodadas', () => {
    const structure = gen('SWISS', 4);
    expect(code(() => generateSwissRound(structure, createStageState()))).toBe('STAGE_INCOMPLETE');
    const done = simulate(structure, 'suico');
    expect(done.structure.matches.filter((m) => m.round === 2)).toHaveLength(2);
    expect(code(() => generateSwissRound(done.structure, done.state))).toBe('INVALID_CONFIG');
    expect(code(() => generateSwissRound(gen('ROUND_ROBIN', 4), createStageState()))).toBe('INVALID_CONFIG');
  });

  it('avisa quando não dá para parear sem repetir', () => {
    // Saem p2 e p4: sobram p1 e p3, que já se enfrentaram na rodada 1.
    let stuck = start(gen('SWISS', 4, { rounds: 3 }));
    stuck = win(stuck, 'sw-r1-m1', 'p1');
    stuck = win(stuck, 'sw-r1-m2', 'p2');
    stuck = withdrawEntrant(stuck.structure, stuck.state, { entrantId: 'p2', kind: 'WITHDRAWN' });
    stuck = withdrawEntrant(stuck.structure, stuck.state, { entrantId: 'p4', kind: 'WITHDRAWN' });
    expect(code(() => generateSwissRound(stuck.structure, stuck.state))).toBe('SWISS_PAIRING_IMPOSSIBLE');
    stuck = withdrawEntrant(stuck.structure, stuck.state, { entrantId: 'p3', kind: 'WITHDRAWN' });
    expect(code(() => generateSwissRound(stuck.structure, stuck.state))).toBe('SWISS_PAIRING_IMPOSSIBLE');
  });
});

describe('withdrawEntrant (RN-06)', () => {
  it('eliminatória: partida atual vira W.O. e o adversário avança', () => {
    const snap = withdrawEntrant(gen('SINGLE_ELIM', 4), createStageState(), { entrantId: 'p1', kind: 'WITHDRAWN' });
    expect(snap.state.entrantStatus).toEqual({ p1: 'WITHDRAWN' });
    expect(snap.state.results['w-r1-m1']).toMatchObject({ winnerId: 'p4', walkover: true });
    expect(slotIds(byId(snap.structure, 'w-r2-m1'))).toEqual(['p4', null]);
  });

  it('eliminatória: resultados passados ficam e as partidas futuras viram W.O.', () => {
    let snap = start(gen('DOUBLE_ELIM', 4));
    snap = win(snap, 'w-r1-m1', 'p1');
    snap = win(snap, 'w-r1-m2', 'p2');
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'DISQUALIFIED' });
    expect(snap.state.results['w-r1-m1']).toMatchObject({ winnerId: 'p1', walkover: false });
    // p1 perde a final de cima por W.O., cai para a chave de baixo e perde de novo quando o adversário chega.
    expect(snap.state.results['w-r2-m1']).toMatchObject({ winnerId: 'p2', walkover: true });
    expect(snap.state.results['l-r2-m1']).toBeUndefined();
    snap = win(snap, 'l-r1-m1', 'p3');
    expect(snap.state.results['l-r2-m1']).toMatchObject({ winnerId: 'p3', loserId: 'p1', walkover: true });
    expect(slotIds(byId(snap.structure, 'gf-1'))).toEqual(['p2', 'p3']);
  });

  it('eliminatória: dois ausentes na mesma partida — avança o da primeira vaga', () => {
    let snap = start(gen('SINGLE_ELIM', 4));
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p2', kind: 'WITHDRAWN' });
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p4', kind: 'WITHDRAWN' });
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'WITHDRAWN' });
    expect(snap.state.results['w-r2-m1']).toMatchObject({ winnerId: 'p3', walkover: true });
    expect(isStageComplete(snap.structure, snap.state)).toBe(true);
    const both = withdrawEntrant(
      withdrawEntrant(gen('SINGLE_ELIM', 2), createStageState(), { entrantId: 'p2', kind: 'WITHDRAWN' }).structure,
      { results: {}, entrantStatus: { p2: 'WITHDRAWN' }, skipped: [] },
      { entrantId: 'p1', kind: 'WITHDRAWN' },
    );
    expect(both.state.results['w-r1-m1']?.winnerId).toBe('p1');
  });

  it('pontos corridos: desistente com menos da metade dos jogos tem tudo anulado', () => {
    let snap = start(gen('ROUND_ROBIN', 6));
    snap = win(snap, 'rr-r1-m1', 'p1');
    snap = win(snap, 'rr-r2-m1', 'p1');
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'WITHDRAWN' });
    const mine = snap.structure.matches.filter((m) => slotIds(m).includes('p1'));
    expect(mine).toHaveLength(5);
    for (const match of mine) {
      expect(snap.state.results[match.id]?.voided).toBe(true);
      expect(getMatchStatus(snap.structure, snap.state, match.id)).toBe('VOIDED');
    }
    expect(snap.state.results['rr-r1-m1']?.winnerId).toBe('p1');
    expect(snap.state.results['rr-r3-m1']?.entries).toEqual([]);
  });

  it('pontos corridos: desistente com metade ou mais perde os restantes por W.O.', () => {
    let snap = start(gen('ROUND_ROBIN', 6));
    snap = win(snap, 'rr-r1-m1', 'p1');
    snap = win(snap, 'rr-r2-m1', 'p1');
    snap = win(snap, 'rr-r3-m1', 'p1');
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'WITHDRAWN' });
    expect(snap.state.results['rr-r1-m1']).toMatchObject({ winnerId: 'p1', voided: false });
    const rest = ['rr-r4-m1', 'rr-r5-m1'].map((id) => snap.state.results[id]);
    for (const result of rest) expect(result).toMatchObject({ loserId: 'p1', walkover: true, voided: false });
    // Segundo desistente: o jogo entre os dois que saíram é anulado.
    let two = start(gen('ROUND_ROBIN', 4));
    two = win(two, 'rr-r1-m1', 'p1');
    two = win(two, 'rr-r2-m1', 'p1');
    two = withdrawEntrant(two.structure, two.state, { entrantId: 'p2', kind: 'WITHDRAWN' });
    two = withdrawEntrant(two.structure, two.state, { entrantId: 'p1', kind: 'WITHDRAWN' });
    expect(two.state.results['rr-r3-m1']?.voided).toBe(true);
  });

  it('pontos corridos: desclassificado tem tudo anulado, mesmo com todos os jogos feitos', () => {
    let snap = simulate(gen('GROUPS', 8, { groupCount: 2 }), 'dq');
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p4', kind: 'DISQUALIFIED' });
    const mine = snap.structure.matches.filter((m) => slotIds(m).includes('p4'));
    expect(mine).toHaveLength(3);
    expect(mine.every((m) => snap.state.results[m.id]?.voided)).toBe(true);
    expect(Object.values(snap.state.results).filter((r) => r.voided)).toHaveLength(3);
  });

  it('suíço: sai dos próximos pareamentos; a partida pendente vira W.O.', () => {
    let snap = start(gen('SWISS', 6));
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'WITHDRAWN' });
    expect(snap.state.results['sw-r1-m1']).toMatchObject({ winnerId: 'p4', walkover: true });
    snap = win(snap, 'sw-r1-m2', 'p2');
    snap = win(snap, 'sw-r1-m3', 'p3');
    const round2 = generateSwissRound(snap.structure, snap.state);
    const playing = round2.matches.filter((m) => m.round === 2).flatMap(slotIds);
    expect(playing).not.toContain('p1');
    expect(playing).toHaveLength(5);
    expect(slotIds(byId(round2, 'sw-r2-bye'))).toEqual(['p6']);
  });

  it('Battle Royale: sai das quedas futuras e os resultados anteriores ficam', () => {
    let snap = start(gen('BATTLE_ROYALE', 3, { drops: 2 }));
    snap = applyResult(snap.structure, snap.state, {
      matchId: 'br-s1-q1',
      entries: [
        { entrantId: 'p1', placement: 1, kills: 4 },
        { entrantId: 'p2', placement: 2, kills: 2 },
        { entrantId: 'p3', placement: 3, kills: 1 },
      ],
    });
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p3', kind: 'WITHDRAWN' });
    expect(snap.state.results['br-s1-q1']?.entries).toHaveLength(3);
    snap = applyResult(snap.structure, snap.state, {
      matchId: 'br-s1-q2',
      entries: [
        { entrantId: 'p1', placement: 2, kills: 0 },
        { entrantId: 'p2', placement: 1, kills: 6 },
      ],
    });
    expect(isStageComplete(snap.structure, snap.state)).toBe(true);
  });

  it('valida a entrada e não rebaixa uma desclassificação', () => {
    const structure = gen('SINGLE_ELIM', 4);
    expect(code(() => withdrawEntrant(structure, createStageState(), { entrantId: 'p9', kind: 'WITHDRAWN' }))).toBe('ENTRANT_NOT_FOUND');
    expect(code(() => withdrawEntrant(structure, createStageState(), { entrantId: 'p1', kind: 'X' as never }))).toBe('INVALID_RESULT');
    const dq = withdrawEntrant(structure, createStageState(), { entrantId: 'p1', kind: 'DISQUALIFIED' });
    const again = withdrawEntrant(dq.structure, dq.state, { entrantId: 'p1', kind: 'WITHDRAWN' });
    expect(again.state.entrantStatus.p1).toBe('DISQUALIFIED');
  });
});

describe('utilitários', () => {
  it('isEliminationFormat', () => {
    expect(['SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM'].every(isEliminationFormat)).toBe(true);
    expect(['GROUPS', 'ROUND_ROBIN', 'SWISS', 'BATTLE_ROYALE'].some(isEliminationFormat)).toBe(false);
  });

  it('getMatchStatus: bye do suíço e partida inexistente', () => {
    const structure = gen('SWISS', 3);
    expect(getMatchStatus(structure, createStageState(), 'sw-r1-bye')).toBe('BYE');
    expect(code(() => getMatchStatus(structure, createStageState(), 'x'))).toBe('MATCH_NOT_FOUND');
    expect(isStageComplete(structure, createStageState())).toBe(false);
  });
});
