/** Quem precisa fazer check-in (issue #84, RN-04), sem banco. */
import { describe, expect, it } from 'vitest';
import { isComplete, requiredUsers, type RosterRegistration } from '../src/competition/check-in';

const at = new Date('2026-11-01T00:00:00Z');
const squad: RosterRegistration = {
  id: 'r-squad',
  userId: null,
  team: { captainId: 'cap' },
  members: [
    { userId: 'cap', isSub: false, confirmedAt: at },
    { userId: 'tit', isSub: false, confirmedAt: at },
    { userId: 'pendente', isSub: false, confirmedAt: null },
    { userId: 'reserva', isSub: true, confirmedAt: at },
  ],
};
const cfg = (requireAllMembers: boolean) => ({ enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers });

describe('quem faz o check-in', () => {
  it('solo: o próprio jogador', () => {
    expect(requiredUsers({ id: 'r1', userId: 'u1', team: null, members: [] }, cfg(true))).toEqual(['u1']);
  });

  it('squad: o capitão; ou todos os titulares confirmados (sem reserva nem pendente)', () => {
    expect(requiredUsers(squad, cfg(false))).toEqual(['cap']);
    expect(requiredUsers(squad, cfg(true))).toEqual(['cap', 'tit']);
  });

  it('a inscrição só conclui quando todos os obrigatórios fizeram; lista vazia nunca conta', () => {
    const done = [{ registrationId: 'r-squad', userId: 'cap' }];
    expect(isComplete(['cap'], done, 'r-squad')).toBe(true);
    expect(isComplete(['cap', 'tit'], done, 'r-squad')).toBe(false);
    expect(isComplete(['cap'], [{ registrationId: 'outra', userId: 'cap' }], 'r-squad')).toBe(false);
    expect(isComplete([], done, 'r-squad')).toBe(false);
    expect(isComplete(undefined, done, 'r-squad')).toBe(false);
  });
});
