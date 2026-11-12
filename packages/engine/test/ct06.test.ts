import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_MODELS,
  advanceStage,
  applyResult,
  computeStandings,
  createStageState,
  generateStage,
  isStageComplete,
} from '../src/index';
import type { ScoringModel, StagePreview, StageSnapshot, StageStructure, StandingRow } from '../src/index';
import {
  EXPECTED_CHAMPION,
  EXPECTED_FINALISTS,
  EXPECTED_FINAL_TABLE,
  EXPECTED_GROUP_TABLES,
  EXPECTED_PHASE2_SEEDS,
  EXPECTED_REPECHAGE,
  FINAL_DROPS,
  FINAL_DROP_MULTIPLIERS,
  GROUPS,
  GROUP_NAMES,
  PHASE1_DROPS,
  QUARTERFINALS,
  SEMIFINALS,
  SQUADS,
  findSeries,
  seriesLoser,
  seriesWinner,
  sumDrops,
} from './fixtures/ct06-ff-48-squads';
import type { DropRow, Series } from './fixtures/ct06-ff-48-squads';
import { slotIds } from './helpers';

const model = (id: string): ScoringModel => DEFAULT_SCORING_MODELS.find((m) => m.id === id) as ScoringModel;
const FF_BR = model('ff-br-padrao');
const CONTRA_SQUAD = model('ff-contra-squad');

const applyDrop = (snap: StageSnapshot, matchId: string, rows: DropRow[]): StageSnapshot =>
  applyResult(snap.structure, snap.state, {
    matchId,
    entries: rows.map(([entrantId, placement, kills]) => ({ entrantId, placement, kills })),
  });

const tableOf = (rows: StandingRow[]) => rows.map((r) => [r.entrantId, r.points, r.booyahs, r.kills]);

/** Joga o mata-mata procurando na planilha a série de cada confronto que o motor montar. */
function playKnockout(structure: StageStructure): StageSnapshot {
  let snap: StageSnapshot = { structure, state: createStageState() };
  const book: Series[] = [...QUARTERFINALS, ...SEMIFINALS];
  for (;;) {
    const match = snap.structure.matches.find((m) => !snap.state.results[m.id] && m.slots.every((slot) => slot.entrantId !== null));
    if (!match) return snap;
    const [x, y] = slotIds(match) as [string, string];
    const series = findSeries(book, x, y);
    if (!series) throw new Error(`A planilha não tem a série ${x} × ${y} (${match.id})`);
    snap = applyResult(snap.structure, snap.state, {
      matchId: match.id,
      entries: [
        { entrantId: series.a, score: series.scoreA },
        { entrantId: series.b, score: series.scoreB },
      ],
    });
  }
}

describe('CT-06 — Free Fire, 48 squads: grupos BR → mata-mata MD3 → final BR', () => {
  // ── Fase 1 ──
  const phase1Structure = generateStage({
    format: 'GROUPS',
    entrants: SQUADS,
    seeding: 'MANUAL',
    seed: 'ct06',
    config: { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3 },
  });
  let phase1: StageSnapshot = { structure: phase1Structure, state: createStageState() };
  GROUP_NAMES.forEach((name, g) => {
    PHASE1_DROPS[name].forEach((rows, d) => {
      phase1 = applyDrop(phase1, `g${g + 1}-q${d + 1}`, rows);
    });
  });
  const toKnockout: StagePreview = advanceStage({
    structure: phase1.structure,
    state: phase1.state,
    standings: { rules: FF_BR.rules, tiebreakers: FF_BR.tiebreakers },
    qualification: { type: 'TOP_N_PER_GROUP', n: 2 },
    next: { format: 'TEAM_VS_TEAM', config: { bestOf: 3, stopAtRemaining: 2 } },
  });

  // ── Fase 2 ──
  const phase2 = playKnockout(toKnockout.next);
  const toFinal: StagePreview = advanceStage({
    structure: phase2.structure,
    state: phase2.state,
    standings: { rules: CONTRA_SQUAD.rules, tiebreakers: CONTRA_SQUAD.tiebreakers },
    qualification: { type: 'WINNERS', repechage: 2 },
    next: { format: 'BATTLE_ROYALE', config: { lobbySize: 4, drops: 5, dropMultipliers: FINAL_DROP_MULTIPLIERS } },
  });

  // ── Fase 3 ──
  let phase3: StageSnapshot = { structure: toFinal.next, state: createStageState() };
  FINAL_DROPS.forEach((rows, d) => {
    phase3 = applyDrop(phase3, `br-s1-q${d + 1}`, rows);
  });
  const finalStandings = computeStandings(phase3.structure, phase3.state, { rules: FF_BR.rules, tiebreakers: FF_BR.tiebreakers });

  it('a planilha fecha com a soma simples (conferência independente do motor)', () => {
    for (const name of GROUP_NAMES) {
      expect(sumDrops(PHASE1_DROPS[name])).toEqual(EXPECTED_GROUP_TABLES[name]);
      expect(PHASE1_DROPS[name]).toHaveLength(3);
      for (const drop of PHASE1_DROPS[name]) {
        expect(drop.map((row) => row[0]).sort()).toEqual(GROUPS[name].slice().sort());
        expect(drop.map((row) => row[1])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }
    }
    expect(QUARTERFINALS.map(seriesWinner)).toEqual(SEMIFINALS.flatMap((s) => [s.a, s.b]));
    expect(SEMIFINALS.map(seriesWinner)).toEqual(EXPECTED_FINALISTS);
    expect(SEMIFINALS.map(seriesLoser)).toEqual(EXPECTED_REPECHAGE);
    expect(sumDrops(FINAL_DROPS, FINAL_DROP_MULTIPLIERS).map((row) => [row[0], row[1]])).toEqual(EXPECTED_FINAL_TABLE);
    expect(EXPECTED_FINAL_TABLE[0]?.[0]).toBe(EXPECTED_CHAMPION);
    expect(SQUADS).toHaveLength(48);
  });

  it('Fase 1: 4 grupos de 12 pela serpentina, 12 quedas', () => {
    expect(phase1Structure.groups.map((g) => g.entrantIds)).toEqual(GROUP_NAMES.map((name) => GROUPS[name]));
    expect(phase1Structure.groups.map((g) => g.name)).toEqual(['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D']);
    expect(phase1Structure.matches).toHaveLength(12);
    expect(isStageComplete(phase1.structure, phase1.state)).toBe(true);
  });

  it('Fase 1: as tabelas dos grupos batem com a planilha', () => {
    GROUP_NAMES.forEach((name, g) => {
      expect(tableOf(toKnockout.standings.groups[g]?.rows ?? [])).toEqual(EXPECTED_GROUP_TABLES[name]);
    });
    // CT-05 dentro do CT-06: 2º e 3º do Grupo A empatam em pontos; decide o Booyah.
    const [, second, third] = toKnockout.standings.groups[0]?.rows ?? [];
    expect([second?.entrantId, second?.points, third?.entrantId, third?.points]).toEqual(['sq09', 18, 'sq01', 18]);
    expect(second?.tiebreakNote).toBe('Empate em pontos com Fúria Norte. Desempate por número de Booyahs (1).');
    expect(toKnockout.standings.drawUsed).toBe(false);
  });

  it('Fase 1 → 2: top 2 de cada grupo, seeds pela classificação', () => {
    expect(toKnockout.qualified.map((q) => q.entrantId)).toEqual(EXPECTED_PHASE2_SEEDS);
    expect(toKnockout.qualified.map((q) => q.groupPosition)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(toKnockout.eliminated).toHaveLength(40);
  });

  it('Fase 2: quartas sem confronto entre 1º e 2º do mesmo grupo, como na planilha', () => {
    const quarters = toKnockout.next.matches.filter((m) => m.round === 1);
    expect(quarters.map(slotIds)).toEqual(QUARTERFINALS.map((s) => [s.a, s.b]));
    expect(quarters.every((m) => m.bestOf === 3 && m.roundLabel === 'Quartas de final')).toBe(true);
    expect(toKnockout.next.matches).toHaveLength(6);
    const groupOf = new Map(toKnockout.qualified.map((q) => [q.entrantId, q.groupId]));
    for (const [x, y] of quarters.map(slotIds)) expect(groupOf.get(x as string)).not.toBe(groupOf.get(y as string));
  });

  it('Fase 2: semifinais e finalistas batem com a planilha', () => {
    const semis = phase2.structure.matches.filter((m) => m.round === 2);
    expect(semis.map(slotIds)).toEqual(SEMIFINALS.map((s) => [s.a, s.b]));
    expect(semis.map((m) => phase2.state.results[m.id]?.winnerId)).toEqual(EXPECTED_FINALISTS);
    expect(isStageComplete(phase2.structure, phase2.state)).toBe(true);
  });

  it('Fase 2 → 3: os 2 finalistas + 2 da repescagem completam a sala', () => {
    const direct = toFinal.qualified.filter((q) => q.via === 'DIRECT').map((q) => q.entrantId);
    const repechage = toFinal.qualified.filter((q) => q.via === 'REPECHAGE').map((q) => q.entrantId);
    expect(direct.sort()).toEqual(EXPECTED_FINALISTS.slice().sort());
    expect(repechage.sort()).toEqual(EXPECTED_REPECHAGE.slice().sort());
    expect(toFinal.next.groups).toHaveLength(1);
    expect(toFinal.next.groups[0]?.entrantIds).toHaveLength(4);
    expect(toFinal.next.matches.map((m) => [m.id, m.roundLabel, m.multiplier])).toEqual([
      ['br-s1-q1', 'Queda 1', 1],
      ['br-s1-q2', 'Queda 2', 1],
      ['br-s1-q3', 'Queda 3', 1],
      ['br-s1-q4', 'Queda 4', 1],
      ['br-s1-q5', 'Queda 5', 2],
    ]);
  });

  it('Fase 3: tabela final e campeão iguais aos da planilha', () => {
    expect(isStageComplete(phase3.structure, phase3.state)).toBe(true);
    expect(finalStandings.overall.map((r) => [r.entrantId, r.points])).toEqual(EXPECTED_FINAL_TABLE);
    expect(finalStandings.overall[0]?.entrantId).toBe(EXPECTED_CHAMPION);
    expect(finalStandings.overall[0]?.name).toBe('Esquadrão Capital');
  });
});
