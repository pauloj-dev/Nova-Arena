import { describe, expect, it } from 'vitest';
import { guestKey, guestRosterProblem } from '../src/rules/guests';
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

describe('elenco sem conta (RN-18)', () => {
  const g = (name: string, extra: { gameId?: string | null; isSub?: boolean } = {}) => ({ name, ...extra });

  it('aceita o elenco dentro do modo, completo ou não', () => {
    expect(guestRosterProblem([], mode)).toBeNull();
    expect(guestRosterProblem([g('A'), g('B')], mode)).toBeNull();
    expect(guestRosterProblem([g('A', { gameId: '1' }), g('B', { gameId: '2' }), g('C'), g('D'), g('E', { isSub: true })], mode)).toBeNull();
  });

  it('recusa titulares ou reservas a mais', () => {
    expect(guestRosterProblem([g('A'), g('B'), g('C'), g('D'), g('E')], mode)).toBe('Este modo tem 4 titulares por squad: o elenco ficaria com 5.');
    expect(guestRosterProblem([g('A', { isSub: true }), g('B', { isSub: true })], mode)).toBe('Este modo aceita 1 reserva por squad: o elenco ficaria com 2.');
    expect(guestRosterProblem([g('A', { isSub: true })], { teamSize: 2, maxSubs: 0 })).toBe('Este modo não tem reservas.');
    expect(guestRosterProblem([g('A'), g('B')], { teamSize: 1, maxSubs: 0 })).toBe('Este modo tem 1 titular por squad: o elenco ficaria com 2.');
  });

  it('recusa nome ou ID no jogo repetido, sem diferenciar maiúsculas nem espaços', () => {
    expect(guestRosterProblem([g('Ana'), g(' ANA ')], mode)).toBe('O jogador "ANA" aparece duas vezes no elenco.');
    expect(guestRosterProblem([g('Ana', { gameId: 'ab1' }), g('Bia', { gameId: ' AB1' })], mode)).toBe('O ID no jogo "AB1" aparece duas vezes no elenco.');
    expect(guestRosterProblem([g('Ana', { gameId: '' }), g('Bia', { gameId: null }), g('Caio')], mode)).toBeNull();
    expect(guestRosterProblem([g('  ')], mode)).toBe('Há um jogador sem nome no elenco.');
    expect(guestKey('  Kauê ')).toBe('kauê');
  });
});

