import { describe, expect, it } from 'vitest';
import { promoteFromWaitlist, promotionFor, waitlistInOrder, type WaitlistContext, type WaitlistRegistration } from './waitlist';

const now = new Date('2026-11-12T12:00:00.000Z');
const ctx = (patch: Partial<WaitlistContext> = {}): WaitlistContext => ({ maxParticipants: 2, manualApproval: false, requiredMembers: 1, registrationClosesAt: '2026-11-20T12:00:00.000Z', now, ...patch });
const reg = (id: string, status: WaitlistRegistration['status'], minute: number, patch: Partial<WaitlistRegistration> = {}): WaitlistRegistration => ({
  id,
  status,
  createdAt: new Date(Date.UTC(2026, 10, 10, 10, minute)).toISOString(),
  confirmedMembers: 1,
  isTeam: false,
  ...patch,
});

describe('RN-12 — promoção da lista de espera', () => {
  it('promove o primeiro que entrou quando abre uma vaga', () => {
    const list = [reg('a', 'CONFIRMED', 0), reg('b', 'CANCELLED', 1), reg('d', 'WAITLIST', 5), reg('c', 'WAITLIST', 3)];
    expect(promoteFromWaitlist(list, ctx())).toEqual([{ id: 'c', status: 'CONFIRMED', reservedUntil: null }]);
  });

  it('não promove ninguém sem vaga livre', () => {
    const list = [reg('a', 'CONFIRMED', 0), reg('b', 'PENDING_APPROVAL', 1), reg('c', 'WAITLIST', 3)];
    expect(promoteFromWaitlist(list, ctx())).toEqual([]);
  });

  it('preenche todas as vagas livres, na ordem de entrada', () => {
    const list = [reg('x', 'REJECTED', 0), reg('c', 'WAITLIST', 3), reg('d', 'WAITLIST', 4), reg('e', 'WAITLIST', 5)];
    expect(promoteFromWaitlist(list, ctx()).map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('com aprovação manual, o promovido entra aguardando aprovação', () => {
    expect(promoteFromWaitlist([reg('c', 'WAITLIST', 3)], ctx({ manualApproval: true }))).toEqual([{ id: 'c', status: 'PENDING_APPROVAL', reservedUntil: null }]);
  });

  it('squad incompleto fica aguardando membros, com a vaga reservada por 24 horas', () => {
    const squad = reg('c', 'WAITLIST', 3, { isTeam: true, confirmedMembers: 2 });
    expect(promoteFromWaitlist([squad], ctx({ requiredMembers: 4 }))).toEqual([{ id: 'c', status: 'PENDING_MEMBERS', reservedUntil: '2026-11-13T12:00:00.000Z' }]);
  });

  it('a reserva vai só até o fechamento das inscrições, se ele vier antes', () => {
    const squad = reg('c', 'WAITLIST', 3, { isTeam: true, confirmedMembers: 2 });
    const result = promoteFromWaitlist([squad], ctx({ requiredMembers: 4, registrationClosesAt: '2026-11-12T18:00:00.000Z' }));
    expect(result[0]?.reservedUntil).toBe('2026-11-12T18:00:00.000Z');
  });

  it('depois do fechamento das inscrições, o squad incompleto é pulado e a vaga vai para o próximo', () => {
    const closed = ctx({ requiredMembers: 4, registrationClosesAt: '2026-11-12T11:00:00.000Z' });
    const incomplete = reg('c', 'WAITLIST', 3, { isTeam: true, confirmedMembers: 2 });
    const complete = reg('d', 'WAITLIST', 4, { isTeam: true, confirmedMembers: 4 });
    expect(promoteFromWaitlist([reg('a', 'CONFIRMED', 0), incomplete, complete], closed)).toEqual([{ id: 'd', status: 'CONFIRMED', reservedUntil: null }]);
    // Sozinho na fila, ele continua esperando: ninguém é promovido.
    expect(promoteFromWaitlist([reg('a', 'CONFIRMED', 0), incomplete], closed)).toEqual([]);
  });

  it('substituição escolhida pela organização segue a mesma regra', () => {
    const squad = reg('c', 'WAITLIST', 3, { isTeam: true, confirmedMembers: 2 });
    const open = ctx({ requiredMembers: 4 });
    expect(promotionFor(squad, open)).toEqual({ id: 'c', status: 'PENDING_MEMBERS', reservedUntil: '2026-11-13T12:00:00.000Z' });
    expect(promotionFor(squad, { ...open, registrationClosesAt: '2026-11-12T11:00:00.000Z' })).toBeNull();
    expect(promotionFor(reg('s', 'WAITLIST', 4), { ...open, manualApproval: true })).toEqual({ id: 's', status: 'PENDING_APPROVAL', reservedUntil: null });
  });

  it('squad completo e inscrição importada (sem conta) entram confirmados', () => {
    const full = reg('c', 'WAITLIST', 3, { isTeam: true, confirmedMembers: 4 });
    const imported = reg('d', 'WAITLIST', 4, { isTeam: false, confirmedMembers: 0 });
    expect(promoteFromWaitlist([full, imported], ctx({ requiredMembers: 4 })).map((p) => p.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });

  it('waitlistInOrder devolve a fila na ordem de entrada', () => {
    const list = [reg('b', 'WAITLIST', 9), reg('a', 'CONFIRMED', 0), reg('c', 'WAITLIST', 2)];
    expect(waitlistInOrder(list).map((r) => r.id)).toEqual(['c', 'b']);
  });
});
