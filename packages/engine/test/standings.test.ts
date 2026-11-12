import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_MODELS,
  applyResult,
  applyWalkover,
  computeStandings,
  createStageState,
  generateStage,
  withdrawEntrant,
} from '../src/index';
import type { Rule, StageConfig, StageFormat, StageSnapshot, StageStructure, Tiebreaker } from '../src/index';
import { makeEntrants, simulate, start, win } from './helpers';

const gen = (format: StageFormat, n: number, config: StageConfig = {}): StageStructure =>
  generateStage({ format, entrants: makeEntrants(n), config, seeding: 'RANKED', seed: 'tabela' });

const rulesOf = (id: string): Rule[] => DEFAULT_SCORING_MODELS.find((m) => m.id === id)?.rules ?? [];
const FF = DEFAULT_SCORING_MODELS[0]!;
const EFOOTBALL = rulesOf('efootball-1v1');

type Drop = Array<[id: string, placement: number, kills: number]>;
const playDrops = (structure: StageStructure, drops: Record<string, Drop>): StageSnapshot => {
  let snap = start(structure);
  for (const [matchId, rows] of Object.entries(drops)) {
    snap = applyResult(snap.structure, snap.state, {
      matchId,
      entries: rows.map(([entrantId, placement, kills]) => ({ entrantId, placement, kills })),
    });
  }
  return snap;
};

const score = (snap: StageSnapshot, matchId: string, a: number, b: number): StageSnapshot => {
  const match = snap.structure.matches.find((m) => m.id === matchId)!;
  return applyResult(snap.structure, snap.state, {
    matchId,
    entries: [
      { entrantId: match.slots[0]!.entrantId!, score: a },
      { entrantId: match.slots[1]!.entrantId!, score: b },
    ],
  });
};

describe('computeStandings — Battle Royale', () => {
  it('CT-05: empate em pontos decidido por Booyahs', () => {
    const snap = playDrops(gen('BATTLE_ROYALE', 3, { drops: 2 }), {
      'br-s1-q1': [
        ['p1', 1, 2],
        ['p2', 2, 5],
        ['p3', 3, 1],
      ],
      'br-s1-q2': [
        ['p1', 2, 3],
        ['p2', 3, 3],
        ['p3', 1, 0],
      ],
    });
    const { overall, groups, drawUsed } = computeStandings(snap.structure, snap.state, {
      rules: FF.rules,
      tiebreakers: FF.tiebreakers,
    });
    expect(overall.map((r) => [r.entrantId, r.position, r.points, r.booyahs, r.kills])).toEqual([
      ['p1', 1, 8, 1, 5],
      ['p2', 2, 8, 0, 8],
      ['p3', 3, 4, 1, 1],
    ]);
    expect(overall[0]?.tiebreakNote).toBe('Empate em pontos com Jogador 2. Desempate por número de Booyahs (1).');
    expect(overall[1]?.tiebreakNote).toBe('Empate em pontos com Jogador 1. Desempate por número de Booyahs (0).');
    expect(overall[2]?.tiebreakNote).toBeNull();
    expect(drawUsed).toBe(false);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ groupId: 's1', name: 'Sala 1' });
    expect(groups[0]?.rows.map((r) => r.entrantId)).toEqual(['p1', 'p2', 'p3']);
    expect(overall[0]).toMatchObject({ played: 2, wins: 1, avgPlacement: 1.5, lastDropKills: 3, scoreFor: 5, groupId: 's1', status: 'ACTIVE' });
  });

  const killsOnly: Rule[] = [{ type: 'PER_UNIT', stat: 'kills', points: 1 }];
  const tied = (): StageSnapshot =>
    playDrops(gen('BATTLE_ROYALE', 3, { drops: 2 }), {
      'br-s1-q1': [
        ['p1', 1, 3],
        ['p2', 2, 2],
        ['p3', 3, 4],
      ],
      'br-s1-q2': [
        ['p1', 2, 2],
        ['p2', 1, 3],
        ['p3', 3, 1],
      ],
    });
  const order = (tiebreakers: Tiebreaker[], drawSeed?: string) => {
    const snap = tied();
    return computeStandings(snap.structure, snap.state, { rules: killsOnly, tiebreakers, drawSeed });
  };

  it('colocação média e kills na última queda', () => {
    const { overall } = order(['points', 'avgPlacement', 'lastDropKills']);
    expect(overall.map((r) => r.entrantId)).toEqual(['p2', 'p1', 'p3']);
    expect(overall[0]?.tiebreakNote).toBe('Empate em pontos com Jogador 1. Desempate por kills na última queda (3).');
    expect(overall[1]?.tiebreakNote).toBe('Empate em pontos com Jogador 2. Desempate por kills na última queda (2).');
    expect(overall[2]?.tiebreakNote).toBe('Empate em pontos com Jogador 1 e Jogador 2. Desempate por colocação média (3).');
  });

  it('`points` entra sozinho na frente e sinônimos valem (booyahs = wins, kills = score)', () => {
    expect(order(['booyahs', 'lastDropKills']).overall.map((r) => r.entrantId)).toEqual(['p2', 'p1', 'p3']);
    expect(order(['wins', 'booyahs', 'lastDropKills']).overall.map((r) => r.entrantId)).toEqual(['p2', 'p1', 'p3']);
    expect(order(['points', 'kills']).overall[0]?.tiebreakNote).toBe(
      'Empate em todos os critérios com Jogador 2 e Jogador 3. Mantida a ordem das seeds.',
    );
    expect(order(['points', 'score', 'headToHead', 'scoreDiff']).overall.map((r) => r.entrantId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('total de kills desempata', () => {
    const snap = playDrops(gen('BATTLE_ROYALE', 2), { 'br-s1-q1': [['p1', 1, 0], ['p2', 2, 3]] });
    const { overall } = computeStandings(snap.structure, snap.state, { rules: FF.rules, tiebreakers: ['points', 'kills'] });
    expect(overall.map((r) => r.entrantId)).toEqual(['p2', 'p1']);
    expect(overall[0]?.tiebreakNote).toBe('Empate em pontos com Jogador 1. Desempate por total de kills (3).');
  });

  it('sorteio com seed registrada é reproduzível', () => {
    const a = order(['points', 'draw'], 'auditoria-1');
    const b = order(['points', 'draw'], 'auditoria-1');
    expect(a).toEqual(b);
    expect(a.drawUsed).toBe(true);
    expect(a.drawSeed).toBe('auditoria-1');
    expect(a.overall[0]?.tiebreakNote).toContain('Desempate por sorteio (seed "auditoria-1").');
    const orders = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => order(['draw'], s).overall.map((r) => r.entrantId).join()));
    expect(orders.size).toBeGreaterThan(1);
    expect(order(['points', 'draw']).drawSeed).toBe('tabela');
  });

  it('ordem padrão dos critérios quando nenhuma é informada', () => {
    const snap = tied();
    const { overall } = computeStandings(snap.structure, snap.state, { rules: killsOnly });
    // pontos 5/5/5 → vitórias 1/1/0 → kills 5/5 → colocação média 1.5/1.5 → … → kills na última queda 3 x 2
    expect(overall.map((r) => r.entrantId)).toEqual(['p2', 'p1', 'p3']);
  });

  it('multiplicador da queda e regra "última queda vale ×2"', () => {
    const drops = {
      'br-s1-q1': [['p1', 1, 2], ['p2', 2, 1]] as Drop,
      'br-s1-q2': [['p1', 2, 1], ['p2', 1, 2]] as Drop,
    };
    const byMatch = playDrops(gen('BATTLE_ROYALE', 2, { drops: 2, dropMultipliers: [1, 2] }), drops);
    expect(computeStandings(byMatch.structure, byMatch.state, { rules: FF.rules }).overall.map((r) => [r.entrantId, r.points])).toEqual([
      ['p2', 11],
      ['p1', 7],
    ]);
    const byRule = playDrops(gen('BATTLE_ROYALE', 2, { drops: 2 }), drops);
    const rules: Rule[] = [...FF.rules, { type: 'MULTIPLIER', factor: 2, when: { matchIndex: 'last' } }];
    expect(computeStandings(byRule.structure, byRule.state, { rules }).overall.map((r) => r.points)).toEqual([11, 7]);
  });

  it('ausente na queda não pontua nem conta colocação; W.O. = 0 kill (RN-04)', () => {
    let snap = start(gen('BATTLE_ROYALE', 3));
    snap = applyResult(snap.structure, snap.state, {
      matchId: 'br-s1-q1',
      entries: [
        { entrantId: 'p1', placement: 1, kills: 4 },
        { entrantId: 'p2', placement: 2, kills: 1 },
        { entrantId: 'p3', absent: true },
      ],
    });
    const last = computeStandings(snap.structure, snap.state, { rules: FF.rules }).overall[2];
    expect(last).toMatchObject({ entrantId: 'p3', points: 0, kills: 0, played: 0, avgPlacement: null });
  });

  it('desistente mantém os pontos; desclassificado zera e vai para o fim (RN-05, RN-06)', () => {
    let snap = playDrops(gen('BATTLE_ROYALE', 3), { 'br-s1-q1': [['p1', 1, 9], ['p2', 2, 4], ['p3', 3, 1]] });
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p2', kind: 'WITHDRAWN' });
    const withdrawn = computeStandings(snap.structure, snap.state, { rules: FF.rules }).overall;
    expect(withdrawn.map((r) => [r.entrantId, r.points, r.status])).toEqual([
      ['p1', 12, 'ACTIVE'],
      ['p2', 4, 'WITHDRAWN'],
      ['p3', 1, 'ACTIVE'],
    ]);
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'DISQUALIFIED' });
    const dq = computeStandings(snap.structure, snap.state, { rules: FF.rules }).overall;
    expect(dq.map((r) => [r.entrantId, r.points, r.kills, r.booyahs, r.status])).toEqual([
      ['p2', 4, 4, 0, 'WITHDRAWN'],
      ['p3', 1, 1, 0, 'ACTIVE'],
      ['p1', 0, 0, 0, 'DISQUALIFIED'],
    ]);
    expect(dq[2]?.tiebreakNote).toBe('Desclassificado: pontuação zerada.');
    expect(dq[2]).toMatchObject({ played: 0, avgPlacement: null, position: 3 });
  });

  it('tabela por grupo e geral nas quedas em grupos', () => {
    const snap = simulate(gen('GROUPS', 8, { groupCount: 2, groupMode: 'BATTLE_ROYALE', drops: 2 }), 'grupos-br');
    const standings = computeStandings(snap.structure, snap.state, { rules: FF.rules, tiebreakers: FF.tiebreakers });
    expect(standings.groups.map((g) => [g.groupId, g.name, g.rows.length])).toEqual([
      ['g1', 'Grupo A', 4],
      ['g2', 'Grupo B', 4],
    ]);
    for (const group of standings.groups) {
      expect(group.rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
      expect(group.rows.every((r) => r.groupId === group.groupId && r.played === 2)).toBe(true);
      const points = group.rows.map((r) => r.points);
      expect(points).toEqual(points.slice().sort((a, b) => b - a));
    }
    expect(standings.overall.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(standings.format).toBe('GROUPS');
  });
});

describe('computeStandings — duelos', () => {
  it('sem resultado, todos zerados na ordem das seeds', () => {
    const structure = gen('ROUND_ROBIN', 3);
    const { overall, groups } = computeStandings(structure, createStageState(), { rules: EFOOTBALL });
    expect(overall.map((r) => [r.entrantId, r.points, r.position])).toEqual([
      ['p1', 0, 1],
      ['p2', 0, 2],
      ['p3', 0, 3],
    ]);
    expect(groups).toEqual([{ groupId: null, name: 'Classificação', rows: overall }]);
  });

  it('vitórias, saldo e explicação do desempate', () => {
    const rules: Rule[] = [{ type: 'OUTCOME', win: 2, draw: 1, loss: 0 }];
    let snap = start(gen('ROUND_ROBIN', 4));
    snap = score(snap, 'rr-r1-m1', 1, 0); // p1 1×0 p4
    snap = score(snap, 'rr-r1-m2', 1, 1); // p2 1×1 p3
    snap = score(snap, 'rr-r2-m1', 1, 0); // p3 1×0 p1
    snap = score(snap, 'rr-r2-m2', 0, 0); // p4 0×0 p2
    snap = score(snap, 'rr-r3-m1', 0, 3); // p1 0×3 p2
    snap = score(snap, 'rr-r3-m2', 2, 2); // p3 2×2 p4
    const { overall } = computeStandings(snap.structure, snap.state, {
      rules,
      tiebreakers: ['points', 'wins', 'scoreDiff', 'score', 'headToHead', 'draw'],
    });
    expect(overall.map((r) => r.entrantId)).toEqual(['p2', 'p3', 'p1', 'p4']);
    expect(overall[0]).toMatchObject({
      played: 3,
      wins: 1,
      draws: 2,
      losses: 0,
      points: 4,
      scoreFor: 4,
      scoreAgainst: 1,
      scoreDiff: 3,
      booyahs: 0,
      kills: 0,
      avgPlacement: null,
      eliminated: false,
    });
    expect(overall.map((r) => r.tiebreakNote)).toEqual([
      'Empate em pontos com Jogador 3. Desempate por saldo (+3).',
      'Empate em pontos com Jogador 2. Desempate por saldo (+1).',
      'Empate em pontos com Jogador 4. Desempate por número de vitórias (1).',
      'Empate em pontos com Jogador 1. Desempate por número de vitórias (0).',
    ]);
  });

  it('confronto direto', () => {
    let snap = start(gen('ROUND_ROBIN', 4));
    snap = score(snap, 'rr-r1-m1', 1, 0); // p1 vence p4
    snap = score(snap, 'rr-r1-m2', 1, 0); // p2 vence p3
    snap = score(snap, 'rr-r2-m1', 1, 0); // p3 vence p1
    snap = score(snap, 'rr-r2-m2', 1, 0); // p4 vence p2
    snap = score(snap, 'rr-r3-m1', 1, 0); // p1 vence p2
    snap = score(snap, 'rr-r3-m2', 1, 0); // p3 vence p4
    const { overall } = computeStandings(snap.structure, snap.state, {
      rules: EFOOTBALL,
      tiebreakers: ['points', 'scoreDiff', 'headToHead'],
    });
    expect(overall.map((r) => [r.entrantId, r.points])).toEqual([
      ['p3', 6],
      ['p1', 6],
      ['p4', 3],
      ['p2', 3],
    ]);
    expect(overall[0]?.tiebreakNote).toBe('Empate em pontos com Jogador 1. Desempate por confronto direto (3 pts).');
    expect(overall[1]?.tiebreakNote).toBe('Empate em pontos com Jogador 3. Desempate por confronto direto (0 pts).');
  });

  it('total a favor desempata', () => {
    let snap = start(gen('ROUND_ROBIN', 3));
    snap = score(snap, 'rr-r1-m1', 2, 2); // p2 × p3
    snap = score(snap, 'rr-r2-m1', 0, 0); // p3 × p1
    snap = score(snap, 'rr-r3-m1', 1, 1); // p1 × p2
    const { overall } = computeStandings(snap.structure, snap.state, { rules: EFOOTBALL, tiebreakers: ['scoreDiff', 'score'] });
    expect(overall.map((r) => [r.entrantId, r.scoreFor])).toEqual([
      ['p2', 3],
      ['p3', 2],
      ['p1', 1],
    ]);
    expect(overall[0]?.tiebreakNote).toBe('Empate em pontos com Jogador 1 e Jogador 3. Desempate por total a favor (3).');
  });

  it('scoreStat leva o placar para a regra (1 ponto por coroa + 3 por vitória)', () => {
    let snap = start(gen('ROUND_ROBIN', 2));
    snap = score(snap, 'rr-r1-m1', 3, 1);
    const { overall } = computeStandings(snap.structure, snap.state, { rules: rulesOf('cr-1v1'), scoreStat: 'crowns' });
    expect(overall.map((r) => r.points)).toEqual([6, 1]);
    const explicit = applyResult(gen('ROUND_ROBIN', 2), createStageState(), {
      matchId: 'rr-r1-m1',
      entries: [
        { entrantId: 'p1', score: 3, stats: { crowns: 2 } },
        { entrantId: 'p2', score: 1 },
      ],
    });
    expect(
      computeStandings(explicit.structure, explicit.state, { rules: rulesOf('cr-1v1'), scoreStat: 'crowns' }).overall.map((r) => r.points),
    ).toEqual([5, 1]);
  });

  it('W.O. vale vitória pelo placar configurado (RN-04)', () => {
    const snap = applyWalkover(gen('ROUND_ROBIN', 2, { walkoverScore: 2 }), createStageState(), { matchId: 'rr-r1-m1', winnerId: 'p2' });
    const { overall } = computeStandings(snap.structure, snap.state, { rules: rulesOf('cr-1v1'), scoreStat: 'crowns' });
    expect(overall.map((r) => [r.entrantId, r.points, r.scoreFor, r.wins])).toEqual([
      ['p2', 5, 2, 1],
      ['p1', 0, 0, 0],
    ]);
  });

  it('resultados anulados saem da tabela e o desclassificado vai para o fim', () => {
    let snap = simulate(gen('ROUND_ROBIN', 4), 'anulados');
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'DISQUALIFIED' });
    const { overall } = computeStandings(snap.structure, snap.state, { rules: EFOOTBALL });
    expect(overall[3]).toMatchObject({ entrantId: 'p1', points: 0, played: 0, status: 'DISQUALIFIED', position: 4 });
    expect(overall.slice(0, 3).every((r) => r.played === 2)).toBe(true);
  });

  it('bye do suíço conta como vitória', () => {
    const structure = gen('SWISS', 3, { walkoverScore: 3 });
    const { overall } = computeStandings(structure, createStageState(), { rules: EFOOTBALL });
    expect(overall[0]).toMatchObject({ entrantId: 'p3', points: 3, wins: 1, played: 1, scoreFor: 3 });
    const noScore = computeStandings(gen('SWISS', 3), createStageState(), { rules: EFOOTBALL }).overall[0];
    expect(noScore).toMatchObject({ entrantId: 'p3', points: 3, scoreFor: 0 });
  });

  it('grupos de duelos: uma tabela por grupo', () => {
    const snap = simulate(gen('GROUPS', 8, { groupCount: 2 }), 'grupos', undefined, true);
    const standings = computeStandings(snap.structure, snap.state, { rules: EFOOTBALL });
    expect(standings.groups.map((g) => g.rows.map((r) => r.groupId))).toEqual([
      ['g1', 'g1', 'g1', 'g1'],
      ['g2', 'g2', 'g2', 'g2'],
    ]);
    for (const row of standings.overall) expect(row.played).toBe(3);
    const total = standings.overall.reduce((sum, r) => sum + r.wins + r.losses, 0);
    const draws = standings.overall.reduce((sum, r) => sum + r.draws, 0);
    expect(total + draws).toBe(24);
  });
});

describe('computeStandings — eliminatórias', () => {
  it('eliminação simples com 3º lugar: quem foi mais longe fica à frente', () => {
    let snap = start(gen('SINGLE_ELIM', 4, { thirdPlace: true }));
    snap = win(snap, 'w-r1-m1', 'p4');
    snap = win(snap, 'w-r1-m2', 'p2');
    const partial = computeStandings(snap.structure, snap.state, { rules: rulesOf('ff-contra-squad'), tiebreakers: ['points'] }).overall;
    expect(partial.map((r) => [r.entrantId, r.eliminated])).toEqual([
      ['p2', false],
      ['p4', false],
      ['p1', false],
      ['p3', false],
    ]);
    snap = win(snap, '3rd', 'p3');
    snap = win(snap, 'w-r2-m1', 'p4');
    const { overall } = computeStandings(snap.structure, snap.state, { rules: rulesOf('ff-contra-squad') });
    expect(overall.map((r) => [r.entrantId, r.position, r.eliminated, r.points])).toEqual([
      ['p4', 1, false, 6],
      ['p2', 2, true, 3],
      ['p3', 3, true, 3],
      ['p1', 4, true, 0],
    ]);
  });

  it('eliminados na mesma rodada são ordenados pelos critérios', () => {
    let snap = start(gen('TEAM_VS_TEAM', 4, { bestOf: 3 }));
    snap = score(snap, 'w-r1-m1', 2, 1); // p1 2×1 p4
    snap = score(snap, 'w-r1-m2', 2, 0); // p2 2×0 p3
    const { overall } = computeStandings(snap.structure, snap.state, {
      rules: rulesOf('ff-contra-squad'),
      tiebreakers: ['points', 'scoreDiff'],
    });
    expect(overall.map((r) => r.entrantId)).toEqual(['p2', 'p1', 'p4', 'p3']);
    expect(overall[2]?.tiebreakNote).toBe('Empate em pontos com Jogador 3. Desempate por saldo (-1).');
  });

  it('eliminação dupla: só é eliminado quem perde na chave de baixo ou na Grande Final', () => {
    let snap = start(gen('DOUBLE_ELIM', 4));
    snap = win(snap, 'w-r1-m1', 'p1');
    snap = win(snap, 'w-r1-m2', 'p2');
    snap = win(snap, 'w-r2-m1', 'p1');
    const rows = () => computeStandings(snap.structure, snap.state, { rules: EFOOTBALL }).overall;
    expect(rows().every((r) => !r.eliminated)).toBe(true);
    snap = win(snap, 'l-r1-m1', 'p3');
    expect(rows().filter((r) => r.eliminated).map((r) => r.entrantId)).toEqual(['p4']);
    snap = win(snap, 'l-r2-m1', 'p2');
    snap = win(snap, 'gf-1', 'p2');
    expect(rows().filter((r) => r.eliminated).map((r) => r.entrantId)).toEqual(['p3', 'p4']);
    snap = win(snap, 'gf-2', 'p2');
    expect(rows().map((r) => [r.entrantId, r.eliminated])).toEqual([
      ['p2', false],
      ['p1', true],
      ['p3', true],
      ['p4', true],
    ]);
  });

  it('sem reset, o vice sai na Grande Final; com reset não jogado, também', () => {
    let noReset = start(gen('DOUBLE_ELIM', 2, { grandFinalReset: false }));
    noReset = win(noReset, 'w-r1-m1', 'p1');
    noReset = win(noReset, 'gf-1', 'p2');
    expect(computeStandings(noReset.structure, noReset.state, { rules: EFOOTBALL }).overall.map((r) => [r.entrantId, r.eliminated])).toEqual([
      ['p2', false],
      ['p1', true],
    ]);
    let skipped = start(gen('DOUBLE_ELIM', 2));
    skipped = win(skipped, 'w-r1-m1', 'p1');
    skipped = win(skipped, 'gf-1', 'p1');
    expect(computeStandings(skipped.structure, skipped.state, { rules: EFOOTBALL }).overall.map((r) => [r.entrantId, r.eliminated])).toEqual([
      ['p1', false],
      ['p2', true],
    ]);
  });

  it('desclassificado em mata-mata fica por último e eliminado', () => {
    let snap = start(gen('SINGLE_ELIM', 4));
    snap = win(snap, 'w-r1-m1', 'p1');
    snap = withdrawEntrant(snap.structure, snap.state, { entrantId: 'p1', kind: 'DISQUALIFIED' });
    const { overall } = computeStandings(snap.structure, snap.state, { rules: EFOOTBALL });
    expect(overall[3]).toMatchObject({ entrantId: 'p1', status: 'DISQUALIFIED', eliminated: true, points: 0 });
  });
});
