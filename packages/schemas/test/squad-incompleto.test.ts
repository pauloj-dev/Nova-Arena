/** RN-17: o capitão inscreve o squad incompleto, com a vaga reservada como a do promovido da lista de espera. */
import { describe, expect, it } from 'vitest';
import { checkSquadSize, initialReservation, isReservationExpired, squadRegistrationBlock } from '../src';

const mode = { teamSize: 4, maxSubs: 1 };
const now = new Date('2026-11-25T12:00:00.000Z');

describe('squadRegistrationBlock', () => {
  it('squad incompleto pode se inscrever', () => {
    expect(squadRegistrationBlock(checkSquadSize(1, mode))).toBeNull();
    expect(squadRegistrationBlock(checkSquadSize(4, mode))).toBeNull();
  });
  it('squad com jogadores demais continua barrado', () => {
    expect(squadRegistrationBlock(checkSquadSize(6, mode))).toBe('TOO_BIG');
  });
});

describe('initialReservation', () => {
  const base = { status: 'PENDING_MEMBERS' as const, isTeam: true, members: 1, teamSize: 4, now, registrationClosesAt: null };
  it('reserva por 24 h o squad incompleto que pegou vaga', () => {
    expect(initialReservation(base)).toBe('2026-11-26T12:00:00.000Z');
  });
  it('a reserva acaba no fechamento das inscrições, se vier antes', () => {
    expect(initialReservation({ ...base, registrationClosesAt: '2026-11-25T18:00:00.000Z' })).toBe('2026-11-25T18:00:00.000Z');
  });
  it('não reserva squad completo (só falta confirmar), solo nem lista de espera', () => {
    expect(initialReservation({ ...base, members: 4 })).toBeNull();
    expect(initialReservation({ ...base, isTeam: false })).toBeNull();
    expect(initialReservation({ ...base, status: 'WAITLIST' })).toBeNull();
  });
  it('vencida sem completar, a reserva expira (o squad volta ao fim da fila)', () => {
    const reservedUntil = initialReservation(base);
    expect(isReservationExpired({ status: 'PENDING_MEMBERS', reservedUntil }, new Date('2026-11-26T12:00:01.000Z'))).toBe(true);
  });
});
