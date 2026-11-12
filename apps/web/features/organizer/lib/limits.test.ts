import { describe, expect, it } from 'vitest';
import { checkOrganizerLimits, countActiveTournaments, effectiveLimits, isGameAllowed, type OrganizerForLimits } from './limits';

const organizer = (patch: Partial<OrganizerForLimits> = {}): OrganizerForLimits => ({ isAdmin: false, verifiedOrganizer: false, organizerLimits: null, ...patch });

describe('RN-10 — limites do organizador', () => {
  it('padrão: 3 simultâneos; verificado: 10; todos os jogos', () => {
    expect(effectiveLimits(organizer())).toEqual({ maxActiveTournaments: 3, allowedGameIds: [] });
    expect(effectiveLimits(organizer({ verifiedOrganizer: true }))).toEqual({ maxActiveTournaments: 10, allowedGameIds: [] });
  });

  it('o limite definido pelo Admin vale mais que o padrão', () => {
    expect(effectiveLimits(organizer({ verifiedOrganizer: true, organizerLimits: { maxActiveTournaments: 1, allowedGameIds: ['g_8ball'] } }))).toEqual({ maxActiveTournaments: 1, allowedGameIds: ['g_8ball'] });
  });

  it('só contam os estados de Publicado a Pausado, e só os do próprio organizador', () => {
    const list = [
      { ownerId: 'a', status: 'DRAFT' as const },
      { ownerId: 'a', status: 'PUBLISHED' as const },
      { ownerId: 'a', status: 'REGISTRATION_OPEN' as const },
      { ownerId: 'a', status: 'REGISTRATION_CLOSED' as const },
      { ownerId: 'a', status: 'CHECK_IN' as const },
      { ownerId: 'a', status: 'IN_PROGRESS' as const },
      { ownerId: 'a', status: 'PAUSED' as const },
      { ownerId: 'a', status: 'FINISHED' as const },
      { ownerId: 'a', status: 'ARCHIVED' as const },
      { ownerId: 'a', status: 'CANCELLED' as const },
      { ownerId: 'b', status: 'IN_PROGRESS' as const },
    ];
    expect(countActiveTournaments(list, 'a')).toBe(6);
    expect(countActiveTournaments(list, 'b')).toBe(1);
    expect(countActiveTournaments(list, 'c')).toBe(0);
  });

  it('libera enquanto está abaixo do limite e barra ao atingir', () => {
    expect(checkOrganizerLimits(organizer(), { activeCount: 2, gameId: 'g_freefire' })).toEqual({ ok: true });
    const blocked = checkOrganizerLimits(organizer(), { activeCount: 3, gameId: 'g_freefire' });
    expect(blocked).toMatchObject({ ok: false, code: 'ORGANIZER_LIMIT' });
    expect(blocked.ok === false && blocked.message).toContain('limite é de 3');
    expect(checkOrganizerLimits(organizer({ verifiedOrganizer: true }), { activeCount: 9, gameId: 'g_freefire' })).toEqual({ ok: true });
    expect(checkOrganizerLimits(organizer({ verifiedOrganizer: true }), { activeCount: 10, gameId: 'g_freefire' }).ok).toBe(false);
  });

  it('jogos permitidos: lista vazia libera todos; lista preenchida restringe', () => {
    const limited = organizer({ organizerLimits: { maxActiveTournaments: 3, allowedGameIds: ['g_8ball'] } });
    expect(isGameAllowed(organizer(), 'g_freefire')).toBe(true);
    expect(isGameAllowed(limited, 'g_8ball')).toBe(true);
    expect(isGameAllowed(limited, 'g_freefire')).toBe(false);
    const blocked = checkOrganizerLimits(limited, { activeCount: 0, gameId: 'g_freefire', gameName: 'Free Fire' });
    expect(blocked).toMatchObject({ ok: false, code: 'GAME_NOT_ALLOWED' });
    expect(blocked.ok === false && blocked.message).toContain('Free Fire');
  });

  it('jogo não permitido aparece antes do limite de simultâneos', () => {
    const limited = organizer({ organizerLimits: { maxActiveTournaments: 1, allowedGameIds: ['g_8ball'] } });
    expect(checkOrganizerLimits(limited, { activeCount: 5, gameId: 'g_freefire' })).toMatchObject({ code: 'GAME_NOT_ALLOWED' });
  });

  it('Admin não tem limite', () => {
    const admin = organizer({ isAdmin: true, organizerLimits: { maxActiveTournaments: 0, allowedGameIds: ['g_8ball'] } });
    expect(checkOrganizerLimits(admin, { activeCount: 99, gameId: 'g_freefire' })).toEqual({ ok: true });
  });
});
