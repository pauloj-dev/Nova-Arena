import { StageConfig, type Bracket, type Stage } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { duelMatch, participant } from './results/testing';
import { canGenerateNextSwissRound, currentStage, pendingMatches, permissionsOf, seedingContainers, withdrawEffect } from './stageUtils';

const stage = (order: number, status: Stage['status'], format: Stage['format'] = 'SINGLE_ELIM', config: Partial<Stage['config']> = {}): Stage => ({
  id: `s${order}`,
  tournamentId: 't',
  order,
  name: `Fase ${order}`,
  format,
  scoringModelId: 'm',
  config: StageConfig.parse(config),
  qualification: null,
  tiebreakers: ['points'],
  seeding: 'RANDOM',
  randomSeed: null,
  status,
  lockedAt: null,
});

const bracket = (patch: Partial<Bracket>): Bracket => ({ stageId: 's1', tournamentId: 't', format: 'SINGLE_ELIM', state: 'PREVIEW', seeding: 'RANDOM', seedUsed: 'abc', locked: false, rounds: 1, groups: [], entrants: [], matches: [], complete: false, ...patch });
const entrants = (n: number) => Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, name: `P${i + 1}`, tag: null, seed: i + 1 }));

describe('fase atual e partidas pendentes', () => {
  it('a fase atual é a primeira não concluída', () => {
    expect(currentStage([stage(2, 'PENDING'), stage(1, 'COMPLETED'), stage(3, 'PENDING')])?.id).toBe('s2');
    expect(currentStage([stage(1, 'COMPLETED'), stage(2, 'COMPLETED')])?.id).toBe('s2');
    expect(currentStage([])).toBeUndefined();
  });

  it('conta como pendente o que ainda não tem resultado; "se necessário" à espera não conta', () => {
    const matches = [duelMatch('A', 'B', { status: 'VALIDATED' }), duelMatch('C', 'D', { status: 'LIVE' }), duelMatch('E', 'F', { status: 'WALKOVER' }), duelMatch('G', 'H', { ifNecessary: true, waitingPrevious: true }), duelMatch('I', 'J', { status: 'CANCELLED' })];
    expect(pendingMatches(matches)).toHaveLength(1);
  });

  it('suíço: só gera a próxima rodada quando a atual terminou e ainda falta rodada', () => {
    const round = (n: number, status: 'VALIDATED' | 'SCHEDULED') => duelMatch('A', 'B', { round: n, status, bracket: null });
    expect(canGenerateNextSwissRound(bracket({ format: 'SWISS', state: 'CONFIRMED', matches: [round(1, 'VALIDATED'), round(1, 'SCHEDULED')] }), 3)).toBe(false);
    expect(canGenerateNextSwissRound(bracket({ format: 'SWISS', state: 'CONFIRMED', matches: [round(1, 'VALIDATED'), round(1, 'VALIDATED')] }), 3)).toBe(true);
    expect(canGenerateNextSwissRound(bracket({ format: 'SWISS', state: 'CONFIRMED', matches: [round(3, 'VALIDATED')] }), 3)).toBe(false);
    expect(canGenerateNextSwissRound(bracket({ format: 'SINGLE_ELIM', state: 'CONFIRMED', matches: [round(1, 'VALIDATED')] }), 3)).toBe(false);
  });
});

describe('posições para o ajuste manual da chave', () => {
  it('grupos e salas viram um contêiner cada', () => {
    const b = bracket({ format: 'GROUPS', entrants: entrants(4), groups: [{ id: 'a', name: 'Grupo A', registrationIds: ['r1', 'r4'] }, { id: 'b', name: 'Grupo B', registrationIds: ['r2', 'r3'] }] });
    expect(seedingContainers(b).map((c) => [c.label, c.slots.map((s) => s.name)])).toEqual([['Grupo A', ['P1', 'P4']], ['Grupo B', ['P2', 'P3']]]);
  });

  it('no mata-mata, cada confronto inicial é um contêiner e cada participante aparece uma vez', () => {
    const quarter = (pos: number, a: string, b: string) => duelMatch('x', 'y', { id: `s1~q${pos}`, position: pos, round: 1, participants: [participant(a, a), participant(b, b)] });
    const semi = duelMatch('x', 'y', { id: 's1~sf', round: 2, position: 1, roundLabel: 'Semifinal', participants: [participant('r5', 'P5', { isBye: true }), { ...participant('', ''), registrationId: null }] });
    const containers = seedingContainers(bracket({ entrants: entrants(5), matches: [quarter(1, 'r1', 'r4'), quarter(2, 'r2', 'r3'), semi] }));
    expect(containers.map((c) => c.slots.map((s) => s.registrationId))).toEqual([['r1', 'r4'], ['r2', 'r3'], ['r5']]);
    expect(containers[2]?.label).toContain('bye');
  });

  it('sem grupos nem chave, lista na ordem das seeds', () => {
    const containers = seedingContainers(bracket({ format: 'ROUND_ROBIN', entrants: entrants(3).reverse() }));
    expect(containers).toHaveLength(1);
    expect(containers[0]?.slots.map((s) => s.seed)).toEqual([1, 2, 3]);
  });
});

describe('permissões e efeito da saída (RN-06)', () => {
  it('moderador não gerencia; co-organizador gerencia mas não é dono', () => {
    expect(permissionsOf('MODERATOR')).toMatchObject({ canManage: false, isOwner: false, isModerator: true });
    expect(permissionsOf('CO_ORGANIZER')).toMatchObject({ canManage: true, isOwner: false });
    expect(permissionsOf('OWNER')).toMatchObject({ canManage: true, isOwner: true, isAdmin: false });
    expect(permissionsOf('ADMIN')).toMatchObject({ canManage: true, isOwner: true, isAdmin: true });
  });

  it('explica o efeito conforme o formato', () => {
    expect(withdrawEffect(stage(1, 'ACTIVE', 'SINGLE_ELIM'), 'DISQUALIFIED')).toMatch(/W\.O\. para o adversário/);
    expect(withdrawEffect(stage(1, 'ACTIVE', 'GROUPS', { groupMode: 'BATTLE_ROYALE' }), 'DISQUALIFIED')).toMatch(/pontos são zerados/);
    expect(withdrawEffect(stage(1, 'ACTIVE', 'BATTLE_ROYALE'), 'WITHDRAWN')).toMatch(/pontos já feitos ficam/);
    expect(withdrawEffect(stage(1, 'ACTIVE', 'ROUND_ROBIN'), 'DISQUALIFIED')).toMatch(/anulados/);
    expect(withdrawEffect(stage(1, 'ACTIVE', 'GROUPS'), 'WITHDRAWN')).toMatch(/menos da metade/);
    expect(withdrawEffect(stage(1, 'ACTIVE', 'SWISS'), 'DISQUALIFIED')).toMatch(/pontos são zerados/);
    expect(withdrawEffect(undefined, 'WITHDRAWN')).toMatch(/Não há fase em andamento/);
  });
});

