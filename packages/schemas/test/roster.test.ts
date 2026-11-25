import { describe, expect, it } from 'vitest';
import { canCaptainEditRoster, canStaffEditRoster, rosterLimit, rosterNeedsPlayers, statusAfterRosterChange } from '../src/rules/registrations';

const mode = { teamSize: 4, maxSubs: 1 };
const now = new Date('2026-11-24T12:00:00Z');

describe('elenco da inscrição (trava de elenco, PRD §12.1)', () => {
  it('limite do elenco = titulares + reservas', () => {
    expect(rosterLimit(mode)).toBe(5);
    expect(rosterLimit({ teamSize: 2, maxSubs: 0 })).toBe(2);
  });

  it('capitão troca membros até a trava de elenco e só antes de o campeonato começar', () => {
    expect(canCaptainEditRoster({ status: 'REGISTRATION_OPEN', rosterLockAt: null }, now)).toBe(true);
    expect(canCaptainEditRoster({ status: 'REGISTRATION_CLOSED', rosterLockAt: '2026-11-25T00:00:00Z' }, now)).toBe(true);
    expect(canCaptainEditRoster({ status: 'REGISTRATION_OPEN', rosterLockAt: '2026-11-24T12:00:00Z' }, now)).toBe(false);
    expect(canCaptainEditRoster({ status: 'CHECK_IN', rosterLockAt: null }, now)).toBe(false);
    expect(canCaptainEditRoster({ status: 'IN_PROGRESS', rosterLockAt: null }, now)).toBe(false);
  });

  it('organização troca até o fim do campeonato, inclusive com a fase em andamento', () => {
    expect(canStaffEditRoster('IN_PROGRESS')).toBe(true);
    expect(canStaffEditRoster('CHECK_IN')).toBe(true);
    expect(canStaffEditRoster('PAUSED')).toBe(true);
    expect(canStaffEditRoster('FINISHED')).toBe(false);
    expect(canStaffEditRoster('CANCELLED')).toBe(false);
    expect(canStaffEditRoster('DRAFT')).toBe(false);
  });

  it('status depois da troca: completa avança, perde o mínimo volta a aguardar membros, fila não muda', () => {
    const base = { manualApproval: false, requiredMembers: 4 };
    expect(statusAfterRosterChange('PENDING_MEMBERS', { ...base, confirmedMembers: 4 })).toBe('CONFIRMED');
    expect(statusAfterRosterChange('PENDING_MEMBERS', { ...base, manualApproval: true, confirmedMembers: 4 })).toBe('PENDING_APPROVAL');
    expect(statusAfterRosterChange('PENDING_MEMBERS', { ...base, confirmedMembers: 3 })).toBe('PENDING_MEMBERS');
    expect(statusAfterRosterChange('CONFIRMED', { ...base, confirmedMembers: 3 })).toBe('PENDING_MEMBERS');
    expect(statusAfterRosterChange('PENDING_APPROVAL', { ...base, confirmedMembers: 3 })).toBe('PENDING_MEMBERS');
    expect(statusAfterRosterChange('CONFIRMED', { ...base, confirmedMembers: 4 })).toBe('CONFIRMED');
    expect(statusAfterRosterChange('WAITLIST', { ...base, confirmedMembers: 1 })).toBe('WAITLIST');
    expect(statusAfterRosterChange('CANCELLED', { ...base, confirmedMembers: 4 })).toBe('CANCELLED');
  });

  it('squad espera jogadores quando cabe gente e faltam confirmados', () => {
    expect(rosterNeedsPlayers({ members: 3, confirmedMembers: 3 }, mode)).toBe(true);
    expect(rosterNeedsPlayers({ members: 5, confirmedMembers: 3 }, mode)).toBe(false);
    expect(rosterNeedsPlayers({ members: 4, confirmedMembers: 4 }, mode)).toBe(false);
  });
});
