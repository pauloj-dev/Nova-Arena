import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING_CONFIG,
  EngineError,
  applyResult,
  applyWalkover,
  createStageState,
  expectedScore,
  generateStage,
  rankRatings,
  ratingDeltas,
  ratingMatchesFromStage,
  replayRatings,
  sortRatingMatches,
  withdrawEntrant,
} from '../src/index';
import type { RatingMatch, RatingSide } from '../src/index';
import { makeEntrants } from './helpers';

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
const solo = (id: string, placement: number): RatingSide => ({ entrantId: `r-${id}`, placement, members: [id], teamId: null });
const duel = (id: string, at: string, a: string, b: string, result: 'a' | 'b' | 'draw'): RatingMatch => ({
  id,
  at,
  sides: [solo(a, result === 'b' ? 2 : 1), solo(b, result === 'a' ? 2 : 1)],
});

describe('expectedScore', () => {
  it('é 0,5 entre ratings iguais e soma 1 entre os dois lados', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1400, 1000) + expectedScore(1000, 1400)).toBeCloseTo(1, 12);
    // 400 de diferença = 10 × mais chance.
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 12);
  });
});

describe('ratingDeltas', () => {
  it('duelo entre iguais: o vencedor ganha K/2 e o perdedor perde K/2', () => {
    expect(ratingDeltas([{ id: 'a', rating: 1000, placement: 1 }, { id: 'b', rating: 1000, placement: 2 }])).toEqual({ a: 16, b: -16 });
  });

  it('empate entre iguais não muda nada; empate contra o favorito dá pontos ao azarão', () => {
    expect(ratingDeltas([{ id: 'a', rating: 1000, placement: 1 }, { id: 'b', rating: 1000, placement: 1 }])).toEqual({ a: 0, b: 0 });
    const d = ratingDeltas([{ id: 'fav', rating: 1400, placement: 1 }, { id: 'azarao', rating: 1000, placement: 1 }]);
    expect(d.azarao).toBeGreaterThan(0);
    expect((d.fav as number) + (d.azarao as number)).toBeCloseTo(0, 12);
  });

  it('respeita o K configurado e um participante só não muda nada', () => {
    expect(ratingDeltas([{ id: 'a', rating: 1000, placement: 1 }, { id: 'b', rating: 1000, placement: 2 }], { k: 20 })).toEqual({ a: 10, b: -10 });
    expect(ratingDeltas([{ id: 'a', rating: 1000, placement: 1 }])).toEqual({ a: 0 });
    expect(ratingDeltas([])).toEqual({});
  });

  it('queda com N equipes: cada par vale K/(N−1); o 1º ganha, o último perde, soma zero', () => {
    const lobby = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, rating: 1000, placement: i + 1 }));
    const d = ratingDeltas(lobby);
    expect(d.a).toBeCloseTo(16, 12); // 3 pares vencidos × (32/3) × 0,5
    expect(d.d).toBeCloseTo(-16, 12);
    expect(d.b).toBeGreaterThan(0);
    expect(d.c).toBeLessThan(0);
    expect(sum(Object.values(d))).toBeCloseTo(0, 10);
  });

  it('recusa participante repetido e colocação inválida', () => {
    expect(() => ratingDeltas([{ id: 'a', rating: 1000, placement: 1 }, { id: 'a', rating: 1000, placement: 2 }])).toThrow(EngineError);
    expect(() => ratingDeltas([{ id: 'a', rating: 1000, placement: 0 }, { id: 'b', rating: 1000, placement: 2 }])).toThrow(/colocação/);
    expect(() => ratingDeltas([{ id: 'a', rating: 1000, placement: 1.5 }, { id: 'b', rating: 1000, placement: 2 }])).toThrow(/colocação/);
  });
});

describe('propriedades do rating', () => {
  const rating = fc.integer({ min: 100, max: 3000 });

  it('duelo: a soma dos ratings é conservada (vitória, derrota ou empate)', () => {
    fc.assert(
      fc.property(rating, rating, fc.constantFrom<1 | 2>(1, 2), fc.constantFrom<1 | 2>(1, 2), (ra, rb, pa, pb) => {
        const d = ratingDeltas([{ id: 'a', rating: ra, placement: pa }, { id: 'b', rating: rb, placement: pb }]);
        expect((d.a as number) + (d.b as number)).toBeCloseTo(0, 9);
      }),
    );
  });

  it('queda: soma zero e quem ficou na frente nunca ganha menos do que ganharia com rating igual atrás', () => {
    fc.assert(
      fc.property(fc.array(rating, { minLength: 2, maxLength: 12 }), (ratings) => {
        const lobby = ratings.map((r, i) => ({ id: `e${i}`, rating: r, placement: i + 1 }));
        const d = ratingDeltas(lobby);
        expect(sum(Object.values(d))).toBeCloseTo(0, 8);
        // Nenhuma variação passa de K.
        for (const v of Object.values(d)) expect(Math.abs(v)).toBeLessThanOrEqual(DEFAULT_RATING_CONFIG.k + 1e-9);
      }),
    );
  });

  it('vencer nunca diminui o rating; perder nunca aumenta', () => {
    fc.assert(
      fc.property(rating, rating, (ra, rb) => {
        const d = ratingDeltas([{ id: 'a', rating: ra, placement: 1 }, { id: 'b', rating: rb, placement: 2 }]);
        expect(d.a).toBeGreaterThanOrEqual(0);
        expect(d.b).toBeLessThanOrEqual(0);
      }),
    );
  });

  it('a ordem não importa para partidas independentes (participantes diferentes)', () => {
    fc.assert(
      fc.property(fc.constantFrom<'a' | 'b' | 'draw'>('a', 'b', 'draw'), fc.constantFrom<'a' | 'b' | 'draw'>('a', 'b', 'draw'), (r1, r2) => {
        const warmup = [duel('w1', '2026-01-01T00:00:00.000Z', 'p1', 'p3', 'a'), duel('w2', '2026-01-01T00:00:01.000Z', 'p2', 'p4', 'b')];
        const m1 = (at: string) => duel('m1', at, 'p1', 'p2', r1);
        const m2 = (at: string) => duel('m2', at, 'p3', 'p4', r2);
        const first = replayRatings([...warmup, m1('2026-02-01T00:00:00.000Z'), m2('2026-02-02T00:00:00.000Z')]);
        const second = replayRatings([...warmup, m2('2026-02-01T00:00:00.000Z'), m1('2026-02-02T00:00:00.000Z')]);
        for (const id of ['p1', 'p2', 'p3', 'p4']) expect(first.players.records[id]?.rating).toBeCloseTo(second.players.records[id]?.rating as number, 9);
      }),
    );
  });

  it('o replay não depende da ordem do array (só do horário de validação)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), fc.constantFrom<'a' | 'b' | 'draw'>('a', 'b', 'draw')), { minLength: 1, maxLength: 30 }), (games) => {
        const matches = games
          .filter(([a, b]) => a !== b)
          .map(([a, b, r], i) => duel(`m${String(i).padStart(3, '0')}`, `2026-03-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, `p${a}`, `p${b}`, r));
        const forward = replayRatings(matches);
        const backward = replayRatings([...matches].reverse());
        expect(backward).toEqual(forward);
        // Rating total do conjunto conservado: soma = inicial × participantes.
        const records = Object.values(forward.players.records);
        expect(sum(records.map((r) => r.rating))).toBeCloseTo(records.length * DEFAULT_RATING_CONFIG.initial, 6);
      }),
    );
  });
});

describe('replayRatings', () => {
  it('ordena por horário, guarda o histórico e conta vitórias, empates e derrotas', () => {
    const replay = replayRatings([
      duel('m2', '2026-01-02T00:00:00.000Z', 'ana', 'bia', 'draw'),
      duel('m1', '2026-01-01T00:00:00.000Z', 'ana', 'bia', 'a'),
    ]);
    const ana = replay.players.records.ana;
    expect(ana).toMatchObject({ played: 2, wins: 1, draws: 1, losses: 0, peak: 1016, lastMatchAt: '2026-01-02T00:00:00.000Z' });
    expect(replay.players.records.bia).toMatchObject({ played: 2, wins: 0, draws: 1, losses: 1 });
    expect(replay.players.history.map((h) => [h.matchId, h.subjectId, h.before])).toEqual([
      ['m1', 'ana', 1000],
      ['m1', 'bia', 1000],
      ['m2', 'ana', 1016],
      ['m2', 'bia', 984],
    ]);
    // No empate, o favorito (1016) perde um pouco para o azarão.
    expect(ana?.lastDelta).toBeLessThan(0);
    expect(replay.teams.history).toEqual([]);
  });

  it('squad: rating do squad e de cada jogador (média do lado); a variação vai para todos', () => {
    const replay = replayRatings([
      {
        id: 'tvt',
        at: '2026-01-01T00:00:00.000Z',
        sides: [
          { entrantId: 'r1', placement: 1, members: ['a1', 'a2'], teamId: 'squadA' },
          { entrantId: 'r2', placement: 2, members: ['b1', 'b2'], teamId: 'squadB' },
        ],
      },
    ]);
    expect(replay.teams.records.squadA?.rating).toBe(1016);
    expect(replay.teams.records.squadB?.rating).toBe(984);
    for (const id of ['a1', 'a2']) expect(replay.players.records[id]?.rating).toBe(1016);
    for (const id of ['b1', 'b2']) expect(replay.players.records[id]?.rating).toBe(984);
  });

  it('inscrição sem conta joga com o rating inicial e não aparece; jogador repetido conta uma vez', () => {
    const replay = replayRatings([
      {
        id: 'x',
        at: '2026-01-01T00:00:00.000Z',
        sides: [
          { entrantId: 'r1', placement: 1, members: ['a', 'a'], teamId: null },
          { entrantId: 'r2', placement: 2, members: [], teamId: null },
          { entrantId: 'r3', placement: 3, members: ['a', 'c'], teamId: null },
        ],
      },
      { id: 'vazia', at: '2026-01-02T00:00:00.000Z', sides: [solo('z', 1)] },
      { id: 'anonima', at: '2026-01-03T00:00:00.000Z', sides: [{ entrantId: 'q1', placement: 1, members: [], teamId: null }, { entrantId: 'q2', placement: 2, members: [], teamId: null }] },
    ]);
    expect(Object.keys(replay.players.records).sort()).toEqual(['a', 'c']);
    expect(replay.players.records.a?.played).toBe(1);
    // Queda: dividir o 1º lugar não é vitória.
    const tie = replayRatings([{ id: 'q', at: '2026-01-01T00:00:00.000Z', sides: [solo('a', 1), solo('b', 1), solo('c', 2)] }]);
    expect(tie.players.records.a).toMatchObject({ wins: 0, losses: 1, draws: 0 });
  });

  it('rankRatings: maior rating primeiro, empate no rating arredondado divide a posição, provisório abaixo de 5 partidas', () => {
    const replay = replayRatings([duel('m1', '2026-01-01T00:00:00.000Z', 'a', 'b', 'a'), duel('m2', '2026-01-01T00:00:01.000Z', 'c', 'd', 'a')]);
    const rows = rankRatings(replay.players);
    expect(rows.map((r) => [r.subjectId, r.position])).toEqual([
      ['a', 1],
      ['c', 1],
      ['b', 3],
      ['d', 3],
    ]);
    expect(rows.every((r) => r.provisional)).toBe(true);
    expect(rankRatings(replay.players, { provisionalMatches: 1 }).some((r) => r.provisional)).toBe(false);
  });

  it('sortRatingMatches desempata pelo id', () => {
    const at = '2026-01-01T00:00:00.000Z';
    expect(sortRatingMatches([{ id: 'b', at }, { id: 'a', at }, { id: 'a', at }]).map((m) => m.id)).toEqual(['a', 'a', 'b']);
  });
});

describe('ratingMatchesFromStage', () => {
  const resolve = (id: string) => (id === 'p4' ? null : { members: [`u-${id}`], teamId: id === 'p1' ? 'squad-1' : null });
  const timeOf = () => '2026-05-01T12:00:00.000Z';

  it('duelos validados contam; W.O., anulado e sem data ficam de fora', () => {
    const structure = generateStage({ format: 'ROUND_ROBIN', entrants: makeEntrants(4), seeding: 'MANUAL', seed: 's' });
    let state = createStageState();
    const round1 = structure.matches.filter((m) => m.round === 1);
    const [m1, m2] = round1 as [(typeof round1)[number], (typeof round1)[number]];
    const ids = (m: typeof m1) => m.slots.map((s) => s.entrantId as string) as [string, string];
    ({ state } = applyResult(structure, state, { matchId: m1.id, entries: [{ entrantId: ids(m1)[0], score: 2 }, { entrantId: ids(m1)[1], score: 2 }] }));
    ({ state } = applyWalkover(structure, state, { matchId: m2.id, winnerId: ids(m2)[0] }));
    const r2 = structure.matches.find((m) => m.round === 2) as typeof m1;
    ({ state } = applyResult(structure, state, { matchId: r2.id, entries: [{ entrantId: ids(r2)[0], score: 0 }, { entrantId: ids(r2)[1], score: 3 }] }));

    const out = ratingMatchesFromStage(structure, state, { resolve, timeOf, idPrefix: 'fase:' });
    expect(out.map((m) => m.id)).toEqual([`fase:${m1.id}`, `fase:${r2.id}`]);
    expect(out[0]?.sides.map((s) => s.placement)).toEqual([1, 1]);
    expect(out[1]?.sides.find((s) => s.entrantId === ids(r2)[1])?.placement).toBe(1);
    expect(out[1]?.sides.find((s) => s.entrantId === ids(r2)[0])?.placement).toBe(2);
    expect(ratingMatchesFromStage(structure, state, { resolve, timeOf: () => null })).toEqual([]);

    // Desclassificado com menos da metade dos jogos: resultados anulados saem do rating.
    const dq = withdrawEntrant(structure, state, { entrantId: ids(r2)[1], kind: 'DISQUALIFIED' });
    expect(ratingMatchesFromStage(dq.structure, dq.state, { resolve, timeOf }).every((m) => m.sides.every((s) => s.entrantId !== ids(r2)[1]))).toBe(true);
  });

  it('inscrição sem conta vira lado anônimo; squad leva o teamId', () => {
    const structure = generateStage({ format: 'SINGLE_ELIM', entrants: makeEntrants(4), seeding: 'MANUAL', seed: 's' });
    let state = createStageState();
    for (const m of structure.matches.filter((x) => x.round === 1)) {
      const [a, b] = m.slots.map((s) => s.entrantId as string) as [string, string];
      ({ state } = applyResult(structure, state, { matchId: m.id, entries: [{ entrantId: a, score: 1 }, { entrantId: b, score: 0 }] }));
    }
    const out = ratingMatchesFromStage(structure, state, { resolve, timeOf });
    const sides = out.flatMap((m) => m.sides);
    expect(sides.find((s) => s.entrantId === 'p4')).toMatchObject({ members: [], teamId: null });
    expect(sides.find((s) => s.entrantId === 'p1')).toMatchObject({ members: ['u-p1'], teamId: 'squad-1' });
  });

  it('queda de BR: ausentes ficam de fora e a colocação vem do resultado', () => {
    const structure = generateStage({ format: 'BATTLE_ROYALE', entrants: makeEntrants(4), seeding: 'MANUAL', seed: 's', config: { lobbySize: 12, drops: 1 } });
    const lobby = structure.matches[0];
    if (!lobby) throw new Error('sem sala');
    const { state } = applyResult(structure, createStageState(), {
      matchId: lobby.id,
      entries: [
        { entrantId: 'p1', placement: 2, kills: 3 },
        { entrantId: 'p2', placement: 1, kills: 1 },
        { entrantId: 'p3', placement: 3 },
        { entrantId: 'p4', absent: true },
      ],
    });
    const [match] = ratingMatchesFromStage(structure, state, { resolve, timeOf });
    expect(match?.sides.map((s) => [s.entrantId, s.placement])).toEqual([
      ['p1', 2],
      ['p2', 1],
      ['p3', 3],
    ]);
  });

  it('duelo sem vencedor conhecido nem empate não conta', () => {
    const structure = generateStage({ format: 'SINGLE_ELIM', entrants: makeEntrants(2), seeding: 'MANUAL', seed: 's' });
    const node = structure.matches[0];
    if (!node) throw new Error('sem partida');
    const state = createStageState();
    state.results[node.id] = { matchId: node.id, entries: [], winnerId: 'outro', loserId: null, draw: false, walkover: false, voided: false };
    expect(ratingMatchesFromStage(structure, state, { resolve, timeOf })).toEqual([]);
  });
});
