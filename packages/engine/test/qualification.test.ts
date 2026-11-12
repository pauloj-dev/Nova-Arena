import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_MODELS,
  EngineError,
  advanceStage,
  applyQualification,
  applyResult,
  computeStandings,
  createStageState,
  generateStage,
  withdrawEntrant,
} from '../src/index';
import type { QualificationRule, Rule, StageConfig, StageFormat, StageSnapshot, StageStructure, Standings } from '../src/index';
import { makeEntrants, simulate, slotIds, start, win } from './helpers';

const gen = (format: StageFormat, n: number, config: StageConfig = {}): StageStructure =>
  generateStage({ format, entrants: makeEntrants(n), config, seeding: 'RANKED', seed: 'fase-1' });

const rulesOf = (id: string): Rule[] => DEFAULT_SCORING_MODELS.find((m) => m.id === id)?.rules ?? [];
const EFOOTBALL = rulesOf('efootball-1v1');
const FF = rulesOf('ff-br-padrao');

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return 'OK';
};

/** Grupos de 4 em que o melhor seed do grupo vence todos, o segundo vence os demais, e assim por diante. */
const favoritesWin = (structure: StageStructure): StageSnapshot => {
  let snap = start(structure);
  const seedOf = new Map(structure.entrants.map((e) => [e.id, e.seed as number]));
  for (;;) {
    const match = snap.structure.matches.find((m) => !snap.state.results[m.id] && m.slots.every((slot) => slot.entrantId !== null));
    if (!match) return snap;
    const ids = (slotIds(match) as string[]).sort((x, y) => (seedOf.get(x) as number) - (seedOf.get(y) as number));
    snap =
      match.kind === 'LOBBY'
        ? applyResult(snap.structure, snap.state, {
            matchId: match.id,
            entries: ids.map((entrantId, i) => ({ entrantId, placement: i + 1, kills: ids.length - i })),
          })
        : win(snap, match.id, ids[0] as string);
  }
};

const groupStandings = (): Standings => {
  const snap = favoritesWin(gen('GROUPS', 8, { groupCount: 2 }));
  return computeStandings(snap.structure, snap.state, { rules: EFOOTBALL, tiebreakers: ['points'] });
};

describe('applyQualification', () => {
  it('TOP_N_PER_GROUP: primeiros de cada grupo, depois os segundos', () => {
    // Grupo A: p1, p4, p5, p8 · Grupo B: p2, p3, p6, p7
    const { qualified, eliminated } = applyQualification(groupStandings(), { type: 'TOP_N_PER_GROUP', n: 2 });
    expect(qualified).toEqual([
      { entrantId: 'p1', name: 'Jogador 1', groupId: 'g1', groupPosition: 1, overallPosition: 1, via: 'DIRECT', seed: 1 },
      { entrantId: 'p2', name: 'Jogador 2', groupId: 'g2', groupPosition: 1, overallPosition: 2, via: 'DIRECT', seed: 2 },
      { entrantId: 'p3', name: 'Jogador 3', groupId: 'g2', groupPosition: 2, overallPosition: 3, via: 'DIRECT', seed: 3 },
      { entrantId: 'p4', name: 'Jogador 4', groupId: 'g1', groupPosition: 2, overallPosition: 4, via: 'DIRECT', seed: 4 },
    ]);
    expect(eliminated).toEqual(['p5', 'p6', 'p7', 'p8']);
  });

  it('repescagem completa com os melhores eliminados', () => {
    const { qualified, eliminated } = applyQualification(groupStandings(), { type: 'TOP_N_PER_GROUP', n: 1, repechage: 3 });
    expect(qualified.map((q) => [q.entrantId, q.via, q.seed])).toEqual([
      ['p1', 'DIRECT', 1],
      ['p2', 'DIRECT', 2],
      ['p3', 'REPECHAGE', 3],
      ['p4', 'REPECHAGE', 4],
      ['p5', 'REPECHAGE', 5],
    ]);
    expect(eliminated).toEqual(['p6', 'p7', 'p8']);
    expect(applyQualification(groupStandings(), { type: 'TOP_N_PER_GROUP', n: 1, repechage: 0 }).qualified).toHaveLength(2);
  });

  it('TOP_N_OVERALL usa a tabela geral', () => {
    const { qualified } = applyQualification(groupStandings(), { type: 'TOP_N_OVERALL', n: 3 });
    expect(qualified.map((q) => q.entrantId)).toEqual(['p1', 'p2', 'p3']);
    expect(applyQualification(groupStandings(), { type: 'TOP_N_OVERALL', n: 99 }).qualified).toHaveLength(8);
  });

  it('WINNERS: 1º de cada grupo; no mata-mata, quem não foi eliminado', () => {
    expect(applyQualification(groupStandings(), { type: 'WINNERS' }).qualified.map((q) => q.entrantId)).toEqual(['p1', 'p2']);

    const knockout = favoritesWin(gen('TEAM_VS_TEAM', 8, { stopAtRemaining: 2 }));
    const standings = computeStandings(knockout.structure, knockout.state, { rules: rulesOf('ff-contra-squad'), tiebreakers: ['points'] });
    const result = applyQualification(standings, { type: 'WINNERS', repechage: 2 });
    expect(result.qualified.map((q) => [q.entrantId, q.via])).toEqual([
      ['p1', 'DIRECT'],
      ['p2', 'DIRECT'],
      ['p3', 'REPECHAGE'],
      ['p4', 'REPECHAGE'],
    ]);
    expect(result.eliminated).toEqual(['p5', 'p6', 'p7', 'p8']);
    expect(result.qualified[0]).toMatchObject({ groupId: null, groupPosition: 1 });
  });

  it('quem desistiu ou foi desclassificado não se classifica', () => {
    let snap = favoritesWin(gen('GROUPS', 8, { groupCount: 2, groupMode: 'BATTLE_ROYALE' }));
    const all = computeStandings(snap.structure, snap.state, { rules: FF });
    const leaderA = all.groups[0]?.rows[0]?.entrantId as string;
    const secondA = all.groups[0]?.rows[1]?.entrantId as string;
    const thirdA = all.groups[0]?.rows[2]?.entrantId as string;
    const fourthA = all.groups[0]?.rows[3]?.entrantId as string;
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: leaderA, kind: 'DISQUALIFIED' });
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: secondA, kind: 'WITHDRAWN' });
    const standings = computeStandings(snap.structure, snap.state, { rules: FF });
    const fromA = applyQualification(standings, { type: 'TOP_N_PER_GROUP', n: 2 }).qualified.filter((q) => q.groupId === 'g1');
    expect(fromA.map((q) => q.entrantId).sort()).toEqual([thirdA, fourthA].sort());
    expect(applyQualification(standings, { type: 'TOP_N_OVERALL', n: 8, repechage: 8 }).qualified).toHaveLength(6);
  });

  it('recusa regra inválida', () => {
    const standings = groupStandings();
    const apply = (rule: unknown) => code(() => applyQualification(standings, rule as QualificationRule));
    expect(apply({ type: 'TOP_N_PER_GROUP', n: 0 })).toBe('INVALID_QUALIFICATION');
    expect(apply({ type: 'TOP_N_PER_GROUP' })).toBe('INVALID_QUALIFICATION');
    expect(apply({ type: 'TOP_N_OVERALL', n: 1.5 })).toBe('INVALID_QUALIFICATION');
    expect(apply({ type: 'WINNERS', repechage: -1 })).toBe('INVALID_QUALIFICATION');
    expect(apply({ type: 'OUTRA' })).toBe('INVALID_QUALIFICATION');
    expect(apply(undefined)).toBe('INVALID_QUALIFICATION');
  });
});

describe('advanceStage', () => {
  const groupsOf16 = (seed: string): StageSnapshot =>
    simulate(generateStage({ format: 'GROUPS', entrants: makeEntrants(16), config: { groupCount: 4 }, seeding: 'RANDOM', seed }), seed);

  it('exige todas as partidas concluídas', () => {
    const structure = gen('GROUPS', 8, { groupCount: 2 });
    const input = {
      structure,
      state: createStageState(),
      standings: { rules: EFOOTBALL },
      qualification: { type: 'TOP_N_PER_GROUP', n: 2 } as const,
      next: { format: 'SINGLE_ELIM' as const },
    };
    expect(code(() => advanceStage(input))).toBe('STAGE_INCOMPLETE');
    const partial = win(start(structure), 'g1-r1-m1', 'p1');
    expect(code(() => advanceStage({ ...input, state: partial.state }))).toBe('STAGE_INCOMPLETE');
  });

  it('gera a prévia da próxima fase com seeding pela classificação', () => {
    const snap = favoritesWin(gen('GROUPS', 8, { groupCount: 2 }));
    const preview = advanceStage({
      structure: snap.structure,
      state: snap.state,
      standings: { rules: EFOOTBALL, tiebreakers: ['points'] },
      qualification: { type: 'TOP_N_PER_GROUP', n: 2 },
      next: { format: 'SINGLE_ELIM', config: { bestOf: 3, thirdPlace: true } },
    });
    expect(preview.qualified.map((q) => q.entrantId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(preview.eliminated).toEqual(['p5', 'p6', 'p7', 'p8']);
    expect(preview.standings.groups).toHaveLength(2);
    expect(preview.next).toMatchObject({ format: 'SINGLE_ELIM', seeding: 'RANKED', seedUsed: 'fase-1', rounds: 2 });
    expect(preview.next.entrants).toEqual([
      { id: 'p1', name: 'Jogador 1', seed: 1 },
      { id: 'p2', name: 'Jogador 2', seed: 2 },
      { id: 'p4', name: 'Jogador 4', seed: 3 },
      { id: 'p3', name: 'Jogador 3', seed: 4 },
    ]);
    // 1 x 4 e 2 x 3 seriam p1 x p4 (ambos do Grupo A) e p2 x p3 (ambos do B): os segundos trocam de lugar.
    expect(preview.next.matches.filter((m) => m.round === 1).map(slotIds)).toEqual([
      ['p1', 'p3'],
      ['p2', 'p4'],
    ]);
    expect(preview.next.matches).toHaveLength(4);
    expect(preview.next.matches.every((m) => m.bestOf === 3)).toBe(true);
  });

  it('1º e 2º do mesmo grupo nunca se enfrentam na primeira rodada', () => {
    let hadClash = 0;
    for (let i = 0; i < 25; i++) {
      const snap = groupsOf16(`sorteio-${i}`);
      const input = {
        structure: snap.structure,
        state: snap.state,
        standings: { rules: EFOOTBALL },
        qualification: { type: 'TOP_N_PER_GROUP', n: 2 } as const,
      };
      for (const format of ['SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM', 'SWISS'] as const) {
        const preview = advanceStage({ ...input, next: { format } });
        const group = new Map(preview.qualified.map((q) => [q.entrantId, q.groupId]));
        const naive = generateStage({
          format,
          entrants: preview.qualified.map((q) => ({ id: q.entrantId, seed: q.seed })),
          seeding: 'RANKED',
        });
        const clashes = (s: StageStructure) =>
          s.matches.filter((m) => m.round === 1 && m.bracket !== 'LOSERS' && m.bracket !== 'FINAL').filter((m) => {
            const [a, b] = slotIds(m);
            return a !== null && b !== null && group.get(a as string) === group.get(b as string);
          }).length;
        hadClash += clashes(naive);
        expect(clashes(preview.next)).toBe(0);
        expect(preview.next.entrants.map((e) => e.id).sort()).toEqual(preview.qualified.map((q) => q.entrantId).sort());
        expect(preview.next.entrants.map((e) => e.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      }
    }
    expect(hadClash).toBeGreaterThan(0);
  });

  it('quando não há como evitar (um grupo só), mantém o confronto', () => {
    const snap = favoritesWin(gen('ROUND_ROBIN', 4));
    const preview = advanceStage({
      structure: snap.structure,
      state: snap.state,
      standings: { rules: EFOOTBALL },
      qualification: { type: 'TOP_N_OVERALL', n: 2 },
      next: { format: 'SINGLE_ELIM' },
    });
    expect(preview.next.matches.map(slotIds)).toEqual([['p1', 'p2']]);
    const oneGroup = favoritesWin(gen('GROUPS', 4, { groupCount: 1 }));
    const final = advanceStage({
      structure: oneGroup.structure,
      state: oneGroup.state,
      standings: { rules: EFOOTBALL },
      qualification: { type: 'TOP_N_PER_GROUP', n: 2 },
      next: { format: 'SINGLE_ELIM' },
    });
    expect(final.next.matches.map(slotIds)).toEqual([['p1', 'p2']]);
  });

  it('próxima fase em grupos ou BR não mexe na distribuição; rating é repassado', () => {
    const structure = generateStage({
      format: 'ROUND_ROBIN',
      entrants: makeEntrants(4).map((e, i) => ({ ...e, rating: 2000 - i })),
      seeding: 'RANKED',
    });
    const snap = favoritesWin(structure);
    const preview = advanceStage({
      structure: snap.structure,
      state: snap.state,
      standings: { rules: EFOOTBALL },
      qualification: { type: 'TOP_N_OVERALL', n: 4 },
      next: { format: 'BATTLE_ROYALE', config: { drops: 5, lobbySize: 4 } },
    });
    expect(preview.next.groups).toEqual([{ id: 's1', name: 'Sala 1', entrantIds: ['p1', 'p2', 'p3', 'p4'] }]);
    expect(preview.next.matches).toHaveLength(5);
    expect(preview.next.entrants[0]).toEqual({ id: 'p1', name: 'Jogador 1', seed: 1, rating: 2000 });
  });

  it('próxima fase com sorteio usa a seed informada (ou sorteia uma)', () => {
    const snap = favoritesWin(gen('ROUND_ROBIN', 4));
    const base = {
      structure: snap.structure,
      state: snap.state,
      standings: { rules: EFOOTBALL },
      qualification: { type: 'TOP_N_OVERALL', n: 4 } as const,
    };
    const a = advanceStage({ ...base, next: { format: 'SINGLE_ELIM', seeding: 'RANDOM', seed: 'fase-2' } });
    const b = advanceStage({ ...base, next: { format: 'SINGLE_ELIM', seeding: 'RANDOM', seed: 'fase-2' } });
    expect(a.next).toEqual(b.next);
    expect(a.next.seedUsed).toBe('fase-2');
    const fresh = advanceStage({ ...base, next: { format: 'SINGLE_ELIM', seeding: 'RANDOM' } });
    expect(fresh.next.seedUsed).not.toBe('');
    expect(fresh.next.seedUsed).not.toBe('fase-1');
  });

  it('recusa regra que classifica menos de 2', () => {
    const snap = favoritesWin(gen('ROUND_ROBIN', 4));
    expect(
      code(() =>
        advanceStage({
          structure: snap.structure,
          state: snap.state,
          standings: { rules: EFOOTBALL },
          qualification: { type: 'TOP_N_OVERALL', n: 1 },
          next: { format: 'SINGLE_ELIM' },
        }),
      ),
    ).toBe('INVALID_QUALIFICATION');
  });
});
