/** Campeonatos sem banco (issue #75): rascunho dos testes é publicável; slug; máquina de estados e limites. */
import { canTransition, checkOrganizerLimits, CheckInConfig, validateDraft, type DraftForValidation } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { slugify } from '../src/modules/tournaments';
import { duelGame, publishableDraft } from './fixtures/tournament';

const ids = { gameId: '00000000-0000-4000-8000-000000000001', modeId: '00000000-0000-4000-8000-000000000002', modelId: '00000000-0000-4000-8000-000000000003' };

function asDraft(): DraftForValidation {
  const d = publishableDraft(ids);
  return {
    name: d.name ?? '',
    description: d.description ?? '',
    rules: d.rules ?? '',
    prize: d.prize ?? '',
    streamUrls: [],
    gameId: ids.gameId,
    gameModeId: ids.modeId,
    maxParticipants: d.maxParticipants ?? 8,
    registrationOpensAt: d.registrationOpensAt ?? null,
    registrationClosesAt: d.registrationClosesAt ?? null,
    startsAt: d.startsAt ?? null,
    rosterLockAt: null,
    checkIn: CheckInConfig.parse({}),
    stages: d.stages ?? [],
  };
}

describe('regras do campeonato', () => {
  it('o rascunho usado nos testes com banco é publicável', () => {
    expect(validateDraft(asDraft(), { games: [duelGame(ids)], now: new Date() })).toEqual([]);
  });

  it('sem fases ou com data no passado, não publica (erro no campo)', () => {
    const issues = validateDraft({ ...asDraft(), stages: [], startsAt: new Date(Date.now() - 3600_000).toISOString() }, { games: [duelGame(ids)], now: new Date() });
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(['startsAt']));
    expect(issues.length).toBeGreaterThan(0);
  });

  it('endereço a partir do nome', () => {
    expect(slugify('Copa Nova Arena — Edição #1!')).toBe('copa-nova-arena-edicao-1');
    expect(slugify('   ')).toBe('');
  });

  it('máquina de estados do §8.3', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransition('DRAFT', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(false);
    expect(canTransition('PAUSED', 'CANCELLED')).toBe(true);
    expect(canTransition('ARCHIVED', 'DRAFT')).toBe(false);
  });

  it('limite do organizador (RN-10): 3 simultâneos; Admin não tem limite', () => {
    const organizer = { isAdmin: false, verifiedOrganizer: false, organizerLimits: null };
    expect(checkOrganizerLimits(organizer, { activeCount: 2, gameId: ids.gameId }).ok).toBe(true);
    const blocked = checkOrganizerLimits(organizer, { activeCount: 3, gameId: ids.gameId });
    expect(blocked.ok ? null : blocked.code).toBe('ORGANIZER_LIMIT');
    expect(checkOrganizerLimits({ ...organizer, isAdmin: true }, { activeCount: 50, gameId: ids.gameId }).ok).toBe(true);
  });
});
