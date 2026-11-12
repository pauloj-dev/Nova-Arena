import { describe, expect, it } from 'vitest';
import {
  canCancelRegistration,
  cancellationDeadline,
  checkSquadSize,
  initialRegistrationStatus,
  isCurrentEntry,
  isReservationExpired,
  missingConfirmations,
  planPromotions,
  registrationPanelView,
  registrationPendencies,
  registrationWindow,
  reservationDeadline,
  squadSizeMessage,
  statusAfterMemberConfirmation,
  type WaitlistEntry,
} from './rules';

const FF_SQUAD = { name: 'Squad', teamSize: 4, maxSubs: 1 };
const NOW = new Date('2026-11-12T15:00:00.000Z');
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString();

describe('checkSquadSize', () => {
  it('aceita do tamanho do modo até o tamanho mais as reservas', () => {
    expect(checkSquadSize(4, FF_SQUAD)).toEqual({ ok: true });
    expect(checkSquadSize(5, FF_SQUAD)).toEqual({ ok: true });
  });
  it('recusa squad menor que o modo e diz quantos faltam', () => {
    expect(checkSquadSize(2, FF_SQUAD)).toEqual({ ok: false, reason: 'TOO_SMALL', missing: 2 });
  });
  it('recusa squad maior que titulares + reservas e diz quantos sobram', () => {
    expect(checkSquadSize(7, FF_SQUAD)).toEqual({ ok: false, reason: 'TOO_BIG', excess: 2 });
  });
  it('modo sem reserva só aceita o tamanho exato', () => {
    const duo = { teamSize: 2, maxSubs: 0 };
    expect(checkSquadSize(2, duo).ok).toBe(true);
    expect(checkSquadSize(3, duo)).toEqual({ ok: false, reason: 'TOO_BIG', excess: 1 });
  });
  it('explica o problema em português', () => {
    expect(squadSizeMessage(checkSquadSize(4, FF_SQUAD), FF_SQUAD)).toBeNull();
    expect(squadSizeMessage(checkSquadSize(3, FF_SQUAD), FF_SQUAD)).toBe('O squad precisa de pelo menos 4 jogadores para o modo Squad. Falta 1.');
    expect(squadSizeMessage(checkSquadSize(2, FF_SQUAD), FF_SQUAD)).toBe('O squad precisa de pelo menos 4 jogadores para o modo Squad. Faltam 2.');
    expect(squadSizeMessage(checkSquadSize(6, FF_SQUAD), FF_SQUAD)).toBe('O squad tem 1 jogador a mais do que o modo Squad aceita (4 + 1 reserva).');
  });
});

describe('registrationWindow', () => {
  const base = { registrationOpensAt: iso(-24), registrationClosesAt: iso(24) };
  it('aberta só com o status "Inscrições abertas" e dentro do prazo', () => {
    expect(registrationWindow({ ...base, status: 'REGISTRATION_OPEN' }, NOW)).toBe('OPEN');
  });
  it('publicado ainda não abriu', () => {
    expect(registrationWindow({ ...base, status: 'PUBLISHED', registrationOpensAt: iso(48) }, NOW)).toBe('NOT_OPEN_YET');
  });
  it('status aberto mas antes da data de abertura conta como não aberto', () => {
    expect(registrationWindow({ ...base, status: 'REGISTRATION_OPEN', registrationOpensAt: iso(1) }, NOW)).toBe('NOT_OPEN_YET');
  });
  it('status aberto mas depois do prazo conta como encerrado', () => {
    expect(registrationWindow({ ...base, status: 'REGISTRATION_OPEN', registrationClosesAt: iso(-1) }, NOW)).toBe('CLOSED');
  });
  it('em andamento, finalizado e fechado ficam encerrados; cancelado é cancelado', () => {
    expect(registrationWindow({ ...base, status: 'IN_PROGRESS' }, NOW)).toBe('CLOSED');
    expect(registrationWindow({ ...base, status: 'FINISHED' }, NOW)).toBe('CLOSED');
    expect(registrationWindow({ ...base, status: 'REGISTRATION_CLOSED' }, NOW)).toBe('CLOSED');
    expect(registrationWindow({ ...base, status: 'CANCELLED' }, NOW)).toBe('CANCELLED');
  });
  it('sem datas vale só o status', () => {
    expect(registrationWindow({ status: 'REGISTRATION_OPEN', registrationOpensAt: null, registrationClosesAt: null }, NOW)).toBe('OPEN');
  });
});

describe('initialRegistrationStatus', () => {
  const solo = { freeSlots: 3, waitlistEnabled: true, manualApproval: false, isTeam: false, confirmedMembers: 1, requiredMembers: 1 };
  const squad = { ...solo, isTeam: true, requiredMembers: 4 };

  it('solo com vaga e aprovação automática entra confirmada', () => {
    expect(initialRegistrationStatus(solo)).toBe('CONFIRMED');
  });
  it('solo com aprovação manual aguarda a organização', () => {
    expect(initialRegistrationStatus({ ...solo, manualApproval: true })).toBe('PENDING_APPROVAL');
  });
  it('sem vaga vai para a lista de espera quando ela está ligada', () => {
    expect(initialRegistrationStatus({ ...solo, freeSlots: 0 })).toBe('WAITLIST');
    expect(initialRegistrationStatus({ ...squad, freeSlots: 0 })).toBe('WAITLIST');
  });
  it('sem vaga e sem lista de espera não entra', () => {
    expect(initialRegistrationStatus({ ...solo, freeSlots: 0, waitlistEnabled: false })).toBe('FULL');
  });
  it('squad fica aguardando membros até o mínimo confirmar (o capitão já conta)', () => {
    expect(initialRegistrationStatus(squad)).toBe('PENDING_MEMBERS');
    expect(initialRegistrationStatus({ ...squad, manualApproval: true })).toBe('PENDING_MEMBERS');
  });
  it('squad que já tem o mínimo confirmado pula direto para aprovação ou confirmada', () => {
    expect(initialRegistrationStatus({ ...squad, confirmedMembers: 4 })).toBe('CONFIRMED');
    expect(initialRegistrationStatus({ ...squad, confirmedMembers: 4, manualApproval: true })).toBe('PENDING_APPROVAL');
  });
});

describe('statusAfterMemberConfirmation', () => {
  it('continua aguardando enquanto não atinge o mínimo', () => {
    expect(statusAfterMemberConfirmation('PENDING_MEMBERS', { manualApproval: false, confirmedMembers: 3, requiredMembers: 4 })).toBe('PENDING_MEMBERS');
  });
  it('ao atingir o mínimo vira confirmada, ou aguarda aprovação se for manual', () => {
    expect(statusAfterMemberConfirmation('PENDING_MEMBERS', { manualApproval: false, confirmedMembers: 4, requiredMembers: 4 })).toBe('CONFIRMED');
    expect(statusAfterMemberConfirmation('PENDING_MEMBERS', { manualApproval: true, confirmedMembers: 4, requiredMembers: 4 })).toBe('PENDING_APPROVAL');
  });
  it('não tira ninguém da lista de espera nem mexe em inscrição já confirmada', () => {
    expect(statusAfterMemberConfirmation('WAITLIST', { manualApproval: false, confirmedMembers: 4, requiredMembers: 4 })).toBe('WAITLIST');
    expect(statusAfterMemberConfirmation('CONFIRMED', { manualApproval: true, confirmedMembers: 5, requiredMembers: 4 })).toBe('CONFIRMED');
  });
});

describe('planPromotions (RN-12)', () => {
  const entry = (id: string, minutes: number, patch: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
    id,
    createdAt: new Date(NOW.getTime() - 3_600_000 + minutes * 60_000).toISOString(),
    isTeam: false,
    confirmedMembers: 1,
    requiredMembers: 1,
    ...patch,
  });
  const base = { manualApproval: false, registrationClosesAt: iso(72), now: NOW };

  it('promove na ordem de entrada, só até o número de vagas livres', () => {
    const waitlist = [entry('c', 3), entry('a', 1), entry('b', 2)];
    expect(planPromotions({ ...base, freeSlots: 2, waitlist })).toEqual([
      { id: 'a', status: 'CONFIRMED', reservedUntil: null },
      { id: 'b', status: 'CONFIRMED', reservedUntil: null },
    ]);
  });
  it('sem vaga livre ou sem fila não promove ninguém', () => {
    expect(planPromotions({ ...base, freeSlots: 0, waitlist: [entry('a', 1)] })).toEqual([]);
    expect(planPromotions({ ...base, freeSlots: 2, waitlist: [] })).toEqual([]);
  });
  it('com aprovação manual o promovido entra aguardando aprovação', () => {
    expect(planPromotions({ ...base, manualApproval: true, freeSlots: 1, waitlist: [entry('a', 1)] })).toEqual([{ id: 'a', status: 'PENDING_APPROVAL', reservedUntil: null }]);
  });
  it('squad completo é promovido direto', () => {
    const waitlist = [entry('s', 1, { isTeam: true, confirmedMembers: 4, requiredMembers: 4 })];
    expect(planPromotions({ ...base, freeSlots: 1, waitlist })).toEqual([{ id: 's', status: 'CONFIRMED', reservedUntil: null }]);
  });
  it('squad incompleto sobe aguardando membros, com a vaga reservada por 24 h', () => {
    const waitlist = [entry('s', 1, { isTeam: true, confirmedMembers: 2, requiredMembers: 4 }), entry('solo', 2)];
    expect(planPromotions({ ...base, freeSlots: 1, waitlist })).toEqual([{ id: 's', status: 'PENDING_MEMBERS', reservedUntil: iso(24) }]);
  });
  it('a reserva termina no fechamento das inscrições quando ele vem antes das 24 h', () => {
    const waitlist = [entry('s', 1, { isTeam: true, confirmedMembers: 1, requiredMembers: 4 })];
    expect(planPromotions({ ...base, registrationClosesAt: iso(5), freeSlots: 1, waitlist })).toEqual([{ id: 's', status: 'PENDING_MEMBERS', reservedUntil: iso(5) }]);
  });
  it('com as inscrições fechadas, squad incompleto é pulado e a vaga vai para o próximo', () => {
    const waitlist = [entry('s', 1, { isTeam: true, confirmedMembers: 1, requiredMembers: 4 }), entry('solo', 2)];
    expect(planPromotions({ ...base, registrationClosesAt: iso(-1), freeSlots: 1, waitlist })).toEqual([{ id: 'solo', status: 'CONFIRMED', reservedUntil: null }]);
  });
});

describe('reserva do squad promovido', () => {
  it('reservationDeadline usa 24 h quando não há data de fechamento', () => {
    expect(reservationDeadline(NOW, null)).toBe(iso(24));
  });
  it('vence só para inscrição aguardando membros com reserva no passado', () => {
    expect(isReservationExpired({ status: 'PENDING_MEMBERS', reservedUntil: iso(-1) }, NOW)).toBe(true);
    expect(isReservationExpired({ status: 'PENDING_MEMBERS', reservedUntil: iso(1) }, NOW)).toBe(false);
    expect(isReservationExpired({ status: 'PENDING_MEMBERS', reservedUntil: null }, NOW)).toBe(false);
    expect(isReservationExpired({ status: 'CONFIRMED', reservedUntil: iso(-1) }, NOW)).toBe(false);
  });
});

describe('cancelamento (RN-06)', () => {
  const checkIn = { enabled: true, opensMinutesBefore: 30 };
  const t = { status: 'REGISTRATION_OPEN' as const, startsAt: iso(10), rosterLockAt: null, checkIn };

  it('o prazo é a abertura do check-in', () => {
    expect(cancellationDeadline(t)).toBe(iso(9.5));
  });
  it('a trava de elenco vale quando vem antes do check-in', () => {
    expect(cancellationDeadline({ ...t, rosterLockAt: iso(2) })).toBe(iso(2));
    expect(cancellationDeadline({ ...t, rosterLockAt: iso(20) })).toBe(iso(9.5));
  });
  it('sem check-in o prazo é o início; sem datas não há prazo', () => {
    expect(cancellationDeadline({ ...t, checkIn: { enabled: false, opensMinutesBefore: 30 } })).toBe(iso(10));
    expect(cancellationDeadline({ ...t, startsAt: null })).toBeNull();
  });
  it('dá para cancelar antes do prazo e não depois', () => {
    expect(canCancelRegistration(t, NOW)).toBe(true);
    expect(canCancelRegistration({ ...t, startsAt: iso(0.25) }, NOW)).toBe(false);
    expect(canCancelRegistration({ ...t, rosterLockAt: iso(-1) }, NOW)).toBe(false);
  });
  it('com o check-in aberto ou o campeonato em andamento não cancela mais, mesmo sem data', () => {
    expect(canCancelRegistration({ ...t, startsAt: null, status: 'CHECK_IN' }, NOW)).toBe(false);
    expect(canCancelRegistration({ ...t, startsAt: null, status: 'IN_PROGRESS' }, NOW)).toBe(false);
    expect(canCancelRegistration({ ...t, startsAt: null, status: 'REGISTRATION_CLOSED' }, NOW)).toBe(true);
  });
});

describe('pendências', () => {
  const member = (userId: string, confirmed: boolean, hasGameAccount = true) => ({ userId, confirmedAt: confirmed ? iso(-1) : null, hasGameAccount });
  const squad = { status: 'PENDING_MEMBERS' as const, teamId: 't1', requiredMembers: 4, waitlistPosition: null };

  it('conta quantas confirmações faltam para o mínimo', () => {
    expect(missingConfirmations({ requiredMembers: 4, members: [member('a', true), member('b', false), member('c', false), member('d', false)] })).toBe(3);
    expect(missingConfirmations({ requiredMembers: 4, members: [member('a', true), member('b', true), member('c', true), member('d', true), member('e', false)] })).toBe(0);
  });
  it('capitão vê quantos membros faltam confirmar', () => {
    const members = [member('cap', true), member('b', true), member('c', true), member('d', false)];
    expect(registrationPendencies({ ...squad, members }, 'cap')).toEqual(['Falta 1 membro confirmar']);
  });
  it('membro que ainda não confirmou vê primeiro a própria pendência', () => {
    const members = [member('cap', true), member('b', false), member('c', false), member('d', false)];
    expect(registrationPendencies({ ...squad, members }, 'b')).toEqual(['Confirme sua participação', 'Faltam 3 membros confirmarem']);
  });
  it('avisa quando falta o ID do jogo de quem está vendo', () => {
    const members = [member('cap', true), member('b', false, false), member('c', true), member('d', true)];
    expect(registrationPendencies({ ...squad, members }, 'b')).toEqual(['Confirme sua participação', 'Informe seu ID do jogo', 'Falta 1 membro confirmar']);
  });
  it('avisa quando o elenco ficou menor que o mínimo (alguém recusou)', () => {
    const members = [member('cap', true), member('b', true), member('c', false)];
    expect(registrationPendencies({ ...squad, members }, 'cap')).toEqual(['Elenco incompleto: faltam 2 jogadores']);
  });
  it('lista de espera mostra a posição; aprovação manual mostra a espera', () => {
    const solo = { teamId: null, requiredMembers: 1, members: [member('me', true)] };
    expect(registrationPendencies({ ...solo, status: 'WAITLIST', waitlistPosition: 3 }, 'me')).toEqual(['3º na lista de espera']);
    expect(registrationPendencies({ ...solo, status: 'PENDING_APPROVAL', waitlistPosition: null }, 'me')).toEqual(['Aguardando a organização aprovar']);
  });
  it('inscrição confirmada ou encerrada não tem pendência', () => {
    const solo = { teamId: null, requiredMembers: 1, members: [member('me', true)], waitlistPosition: null };
    expect(registrationPendencies({ ...solo, status: 'CONFIRMED' }, 'me')).toEqual([]);
    expect(registrationPendencies({ ...solo, status: 'CANCELLED' }, 'me')).toEqual([]);
    expect(registrationPendencies({ ...squad, status: 'REJECTED', members: [member('cap', true), member('b', false)] }, 'b')).toEqual([]);
  });
});

describe('isCurrentEntry', () => {
  it('inscrição valendo em campeonato que não acabou é atual; o resto é histórico', () => {
    expect(isCurrentEntry({ registration: { status: 'CONFIRMED' }, tournament: { status: 'IN_PROGRESS' } })).toBe(true);
    expect(isCurrentEntry({ registration: { status: 'WAITLIST' }, tournament: { status: 'REGISTRATION_OPEN' } })).toBe(true);
    expect(isCurrentEntry({ registration: { status: 'CONFIRMED' }, tournament: { status: 'FINISHED' } })).toBe(false);
    expect(isCurrentEntry({ registration: { status: 'CONFIRMED' }, tournament: { status: 'CANCELLED' } })).toBe(false);
    expect(isCurrentEntry({ registration: { status: 'CANCELLED' }, tournament: { status: 'REGISTRATION_OPEN' } })).toBe(false);
    expect(isCurrentEntry({ registration: { status: 'REJECTED' }, tournament: { status: 'REGISTRATION_OPEN' } })).toBe(false);
  });
});

describe('registrationPanelView', () => {
  const open = { status: 'REGISTRATION_OPEN' as const, registrationOpensAt: iso(-24), registrationClosesAt: iso(24), maxParticipants: 8, takenSlots: 5, waitlistEnabled: true, waitlistCount: 0 };
  const base = { tournament: open, isAuthenticated: true, hasRegistration: false, isOrganizer: false, missingGameAccount: false, now: NOW };

  it('com vaga, quem está logado pode se inscrever', () => {
    expect(registrationPanelView(base)).toEqual({ kind: 'CAN_REGISTER', waitlist: false, waitlistPosition: null, missingGameAccount: false });
  });
  it('visitante vê o convite para entrar', () => {
    expect(registrationPanelView({ ...base, isAuthenticated: false })).toEqual({ kind: 'VISITOR', waitlist: false });
  });
  it('sem vaga oferece a lista de espera com a posição que a pessoa teria', () => {
    const full = { ...open, takenSlots: 8, waitlistCount: 2 };
    expect(registrationPanelView({ ...base, tournament: full })).toEqual({ kind: 'CAN_REGISTER', waitlist: true, waitlistPosition: 3, missingGameAccount: false });
    expect(registrationPanelView({ ...base, tournament: full, isAuthenticated: false })).toEqual({ kind: 'VISITOR', waitlist: true });
  });
  it('sem vaga e sem lista de espera fica esgotado', () => {
    expect(registrationPanelView({ ...base, tournament: { ...open, takenSlots: 8, waitlistEnabled: false } })).toEqual({ kind: 'FULL' });
  });
  it('avisa quando falta o ID do jogo', () => {
    expect(registrationPanelView({ ...base, missingGameAccount: true })).toMatchObject({ kind: 'CAN_REGISTER', missingGameAccount: true });
  });
  it('quem já está inscrito vê a inscrição, mesmo com as inscrições encerradas', () => {
    expect(registrationPanelView({ ...base, hasRegistration: true })).toEqual({ kind: 'REGISTERED' });
    expect(registrationPanelView({ ...base, hasRegistration: true, tournament: { ...open, status: 'IN_PROGRESS' } })).toEqual({ kind: 'REGISTERED' });
  });
  it('organização do campeonato vê a explicação, não o botão', () => {
    expect(registrationPanelView({ ...base, isOrganizer: true })).toEqual({ kind: 'ORGANIZER' });
    expect(registrationPanelView({ ...base, isOrganizer: true, tournament: { ...open, status: 'PUBLISHED' } })).toEqual({ kind: 'ORGANIZER' });
  });
  it('antes de abrir mostra quando abre; depois de fechar, encerradas; cancelado, cancelado', () => {
    expect(registrationPanelView({ ...base, tournament: { ...open, status: 'PUBLISHED', registrationOpensAt: iso(48) } })).toEqual({ kind: 'NOT_OPEN_YET', opensAt: iso(48) });
    expect(registrationPanelView({ ...base, tournament: { ...open, status: 'IN_PROGRESS' } })).toEqual({ kind: 'CLOSED' });
    expect(registrationPanelView({ ...base, isOrganizer: true, tournament: { ...open, status: 'FINISHED' } })).toEqual({ kind: 'CLOSED' });
    expect(registrationPanelView({ ...base, tournament: { ...open, status: 'CANCELLED' } })).toEqual({ kind: 'CANCELLED' });
  });
});
