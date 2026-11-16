/** Chave sem banco (issue #82): mesma semente reproduz a mesma chave; configuração da fase; trava (RN-07). */
import { applyResult, createStageState, generateStage, type Entrant } from '@nova/engine';
import { StageConfig } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { isLocked, readRun, snapshotOf, toEngineConfig } from '../src/competition/run';

const entrants: Entrant[] = Array.from({ length: 8 }, (_, i) => ({ id: `r${i + 1}`, name: `Time ${i + 1}` }));
const stage = { format: 'SINGLE_ELIM' as const, config: StageConfig.parse({ bestOf: 3, thirdPlace: true }), qualification: null };

describe('chave', () => {
  it('Mesma seed reproduz a mesma chave (e outra semente embaralha diferente)', () => {
    const a = generateStage({ format: stage.format, entrants, config: toEngineConfig(stage), seeding: 'RANDOM', seed: 'copa-2026' });
    const b = generateStage({ format: stage.format, entrants, config: toEngineConfig(stage), seeding: 'RANDOM', seed: 'copa-2026' });
    const c = generateStage({ format: stage.format, entrants, config: toEngineConfig(stage), seeding: 'RANDOM', seed: 'outra-semente' });
    expect(a.seedUsed).toBe('copa-2026');
    expect(b).toEqual(a);
    expect(c.entrants.map((e) => e.id)).not.toEqual(a.entrants.map((e) => e.id));
  });

  it('configuração da fase vira configuração do motor', () => {
    expect(toEngineConfig(stage)).toMatchObject({ bestOf: 3, thirdPlace: true });
    const twoFinalists = toEngineConfig({ ...stage, qualification: { type: 'WINNERS', n: 2, repechage: 0 } });
    expect(twoFinalists).toMatchObject({ stopAtRemaining: 2, thirdPlace: false });
    const br = toEngineConfig({ format: 'BATTLE_ROYALE', config: StageConfig.parse({ drops: 3, lobbySize: 12, lastDropMultiplier: 2 }), qualification: null });
    expect(br).toMatchObject({ lobbySize: 12, drops: 3, dropMultipliers: [1, 1, 2] });
  });

  it('trava depois da 1ª partida concluída (só vale para chave confirmada e não destravada)', () => {
    const structure = generateStage({ format: stage.format, entrants, config: toEngineConfig({ ...stage, config: StageConfig.parse({}) }), seeding: 'RANKED', seed: 's' });
    const first = structure.matches.find((m) => m.round === 1 && m.slots.every((s) => s.entrantId));
    if (!first) throw new Error('sem partida da 1ª rodada');
    const [x, y] = first.slots.map((s) => s.entrantId as string);
    const played = applyResult(structure, createStageState(), { matchId: first.id, entries: [{ entrantId: x as string, score: 2 }, { entrantId: y as string, score: 0 }] });

    const snap = (state: typeof played.state, confirmedAt: Date | null, unlocked = false) => readRun({ engineSnapshot: snapshotOf(played.structure, state) as unknown, confirmedAt, unlocked });
    expect(isLocked(snap(createStageState(), new Date()) ?? (null as never))).toBe(false);
    expect(isLocked(snap(played.state, null) ?? (null as never))).toBe(false);
    expect(isLocked(snap(played.state, new Date()) ?? (null as never))).toBe(true);
    expect(isLocked(snap(played.state, new Date(), true) ?? (null as never))).toBe(false);
    expect(readRun({ engineSnapshot: null, confirmedAt: null, unlocked: false })).toBeNull();
  });
});
