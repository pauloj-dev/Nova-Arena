/** Regras da inscrição aplicadas pela API simulada (PRD §9, §12.2, RN-06, RN-12, RN-15). */
import { MyTournamentEntry, Registration, type Registration as RegistrationT } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '@/mocks/db';
import { as, call, mutate, setupMockApi } from './test/mockApi';

setupMockApi();

const OK = { acceptRules: true };
const HOUR = 3_600_000;

describe('POST /tournaments/:id/registrations', () => {
  it('exige login', async () => {
    as(null);
    expect((await call('POST', '/tournaments/tn_efootball/registrations', OK)).status).toBe(401);
  });

  it('exige o aceite do regulamento', async () => {
    as('u_bianca');
    const res = await call('POST', '/tournaments/tn_efootball/registrations', { acceptRules: false });
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION');
  });

  it('organizadora não se inscreve no próprio campeonato; moderador também não', async () => {
    as('u_camila');
    const owner = await call('POST', '/tournaments/copa-nova-ff-squad/registrations', { ...OK, teamId: 't_alfa' });
    expect(owner.status).toBe(403);
    expect(owner.code).toBe('OWN_TOURNAMENT');
    as('u_p06'); // moderador da Copa Nova FF no seed
    const staff = await call('POST', '/tournaments/copa-nova-ff-squad/registrations', { ...OK, teamId: 't_1' });
    expect(staff.code).toBe('OWN_TOURNAMENT');
  });

  it('só aceita com as inscrições abertas e dentro do prazo', async () => {
    as('u_lucas');
    const notYet = await call('POST', '/tournaments/ff-solo-rush/registrations', OK);
    expect(notYet.status).toBe(409);
    expect(notYet.code).toBe('REGISTRATION_NOT_OPEN');
    const running = await call('POST', '/tournaments/liga-semanal-clash-royale/registrations', OK);
    expect(running.code).toBe('REGISTRATION_CLOSED');
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_efootball');
      if (t) t.registrationClosesAt = new Date(Date.now() - HOUR).toISOString();
    });
    const late = await call('POST', '/tournaments/tn_efootball/registrations', OK);
    expect(late.code).toBe('REGISTRATION_CLOSED');
  });

  it('campeonato solo não aceita squad e campeonato de squad exige squad em que sou capitão', async () => {
    as('u_lucas');
    expect((await call('POST', '/tournaments/tn_efootball/registrations', { ...OK, teamId: 't_alfa' })).code).toBe('SOLO_ONLY');
    expect((await call('POST', '/tournaments/tn_copa_ff/registrations', OK)).code).toBe('TEAM_REQUIRED');
    as('u_p01'); // membro do Alfa, não capitão
    const notCaptain = await call('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    expect(notCaptain.status).toBe(403);
    expect(notCaptain.code).toBe('NOT_CAPTAIN');
  });

  it('solo sem o ID do jogo recebe GAME_ACCOUNT_REQUIRED', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_ff_solo');
      if (t) {
        t.status = 'REGISTRATION_OPEN';
        t.registrationOpensAt = new Date(Date.now() - HOUR).toISOString();
      }
    });
    as('u_bianca'); // sem conta de Free Fire no seed
    const res = await call('POST', '/tournaments/tn_ff_solo/registrations', OK);
    expect(res.status).toBe(400);
    expect(res.code).toBe('GAME_ACCOUNT_REQUIRED');
    expect(res.detail).toContain('Free Fire');
  });

  it('solo com vaga entra confirmado, segue o campeonato e não se inscreve duas vezes', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_ff_solo');
      if (t) {
        t.status = 'REGISTRATION_OPEN';
        t.registrationOpensAt = new Date(Date.now() - HOUR).toISOString();
      }
    });
    as('u_lucas');
    const res = await call<RegistrationT>('POST', '/tournaments/tn_ff_solo/registrations', OK);
    expect(res.status).toBe(201);
    expect(Registration.parse(res.data).status).toBe('CONFIRMED');
    expect(db().follows).toContainEqual({ userId: 'u_lucas', targetType: 'TOURNAMENT', targetId: 'tn_ff_solo' });
    expect((await call('POST', '/tournaments/tn_ff_solo/registrations', OK)).code).toBe('ALREADY_REGISTERED');
  });

  it('sem vaga entra na lista de espera com a posição; sem lista de espera, 409', async () => {
    as('u_bianca');
    const res = await call<RegistrationT>('POST', '/tournaments/tn_efootball/registrations', OK);
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('WAITLIST');
    expect(res.data.waitlistPosition).toBe(3);

    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_efootball');
      if (t) t.waitlistEnabled = false;
    });
    as('u_lucas');
    const full = await call('POST', '/tournaments/tn_efootball/registrations', OK);
    expect(full.status).toBe(409);
    expect(full.code).toBe('TOURNAMENT_FULL');
    expect(full.detail).toMatch(/vagas .* esgotadas/i);
  });

  it('squad menor que o modo é barrado; maior que titulares + reservas também', async () => {
    as('u_lucas');
    mutate((d) => {
      const alfa = d.teams.find((x) => x.id === 't_alfa');
      if (alfa) alfa.members = alfa.members.slice(0, 3);
    });
    const small = await call('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    expect(small.status).toBe(409);
    expect(small.code).toBe('TEAM_TOO_SMALL');
    expect(small.detail).toContain('Falta 1');

    mutate((d) => {
      const alfa = d.teams.find((x) => x.id === 't_alfa');
      if (alfa) for (const id of ['u_p50', 'u_p51', 'u_p52']) alfa.members.push({ userId: id, role: 'MEMBER', isSub: true, joinedAt: new Date().toISOString() });
    });
    const big = await call('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    expect(big.code).toBe('TEAM_TOO_BIG');
  });

  it('jogador em dois squads no mesmo campeonato é barrado, dizendo quem', async () => {
    // p04 é capitão do Squad Bravo, já inscrito na Copa Nova FF.
    mutate((d) => {
      d.teams.find((x) => x.id === 't_alfa')?.members.push({ userId: 'u_p04', role: 'MEMBER', isSub: true, joinedAt: new Date().toISOString() });
    });
    as('u_lucas');
    const res = await call('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    expect(res.status).toBe(409);
    expect(res.code).toBe('PLAYER_IN_OTHER_TEAM');
    const nickname = db().users.find((u) => u.id === 'u_p04')?.nickname ?? '';
    expect(res.detail).toContain(nickname);
    expect(res.detail).toContain('Squad Bravo');
  });

  it('squad fica aguardando membros (capitão confirmado) e não se inscreve duas vezes', async () => {
    as('u_lucas');
    const res = await call<RegistrationT>('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('PENDING_MEMBERS');
    expect(res.data.requiredMembers).toBe(4);
    expect(res.data.members.filter((m) => m.confirmedAt !== null).map((m) => m.userId)).toEqual(['u_lucas']);
    expect((await call('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' })).code).toBe('ALREADY_REGISTERED');
  });

  it('quem foi recusado pela organização não se inscreve de novo sozinho', async () => {
    mutate((d) => {
      const r = d.registrations.find((x) => x.tournamentId === 'tn_efootball' && x.userId === 'u_p39');
      if (r) r.status = 'REJECTED';
    });
    as('u_p39');
    expect((await call('POST', '/tournaments/tn_efootball/registrations', OK)).code).toBe('REGISTRATION_REJECTED');
  });
});

describe('confirmação dos membros', () => {
  async function registerAlfa(): Promise<string> {
    as('u_lucas');
    const res = await call<RegistrationT>('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    return res.data.id;
  }

  it('avança para confirmada só quando o mínimo confirma', async () => {
    const id = await registerAlfa();
    as('u_p01');
    expect((await call<RegistrationT>('POST', `/registrations/${id}/confirm`)).data.status).toBe('PENDING_MEMBERS');
    as('u_p02');
    expect((await call<RegistrationT>('POST', `/registrations/${id}/confirm`)).data.status).toBe('PENDING_MEMBERS');
    as('u_p03');
    const last = await call<RegistrationT>('POST', `/registrations/${id}/confirm`);
    expect(last.data.status).toBe('CONFIRMED');
    expect(db().follows).toContainEqual({ userId: 'u_p03', targetType: 'TOURNAMENT', targetId: 'tn_copa_ff' });
    // Confirmar de novo não muda nada.
    expect((await call<RegistrationT>('POST', `/registrations/${id}/confirm`)).data.status).toBe('CONFIRMED');
  });

  it('com aprovação manual, ao atingir o mínimo aguarda a organização', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_copa_ff');
      if (t) t.manualApproval = true;
    });
    const id = await registerAlfa();
    for (const u of ['u_p01', 'u_p02', 'u_p03']) {
      as(u);
      await call('POST', `/registrations/${id}/confirm`);
    }
    expect(db().registrations.find((r) => r.id === id)?.status).toBe('PENDING_APPROVAL');
  });

  it('membro sem o ID do jogo não confirma (GAME_ACCOUNT_REQUIRED)', async () => {
    mutate((d) => {
      const u = d.users.find((x) => x.id === 'u_p01');
      if (u) u.gameAccounts = u.gameAccounts.filter((a) => a.gameId !== 'g_freefire');
    });
    const id = await registerAlfa();
    as('u_p01');
    const res = await call('POST', `/registrations/${id}/confirm`);
    expect(res.status).toBe(400);
    expect(res.code).toBe('GAME_ACCOUNT_REQUIRED');
  });

  it('quem não está no elenco não confirma nem recusa', async () => {
    const id = await registerAlfa();
    as('u_bianca');
    expect((await call('POST', `/registrations/${id}/confirm`)).status).toBe(403);
    expect((await call('POST', `/registrations/${id}/decline`)).status).toBe(403);
  });

  it('membro recusa e sai do elenco; capitão e quem já confirmou não recusam', async () => {
    const id = await registerAlfa();
    as('u_p01');
    expect((await call('POST', `/registrations/${id}/decline`)).status).toBe(204);
    expect(db().registrations.find((r) => r.id === id)?.members.map((m) => m.userId)).toEqual(['u_lucas', 'u_p02', 'u_p03']);
    expect((await call('GET', '/tournaments/tn_copa_ff/my-registration')).data).toBeNull();

    as('u_lucas');
    expect((await call('POST', `/registrations/${id}/decline`)).code).toBe('CAPTAIN_CANNOT_DECLINE');
    as('u_p02');
    await call('POST', `/registrations/${id}/confirm`);
    expect((await call('POST', `/registrations/${id}/decline`)).code).toBe('ALREADY_CONFIRMED');
  });
});

describe('DELETE /registrations/:id (RN-06) e lista de espera (RN-12)', () => {
  const idOf = (tournamentId: string, userId: string) => db().registrations.find((r) => r.tournamentId === tournamentId && r.userId === userId)?.id ?? '';
  const statusOf = (tournamentId: string, userId: string) => db().registrations.find((r) => r.tournamentId === tournamentId && r.userId === userId)?.status;

  it('só o inscrito cancela', async () => {
    as('u_bianca');
    expect((await call('DELETE', `/registrations/${idOf('tn_efootball', 'u_p30')}`)).status).toBe(403);
  });

  it('cancelar libera a vaga e promove o primeiro da lista de espera', async () => {
    as('u_p30');
    expect((await call('DELETE', `/registrations/${idOf('tn_efootball', 'u_p30')}`)).status).toBe(204);
    expect(statusOf('tn_efootball', 'u_p30')).toBe('CANCELLED');
    expect(statusOf('tn_efootball', 'u_p38')).toBe('CONFIRMED');
    expect(statusOf('tn_efootball', 'u_p39')).toBe('WAITLIST');
    as('u_p39');
    expect((await call<RegistrationT>('GET', '/tournaments/tn_efootball/my-registration')).data.waitlistPosition).toBe(1);
    // Quem cancelou não tem mais inscrição ativa e pode entrar de novo (agora no fim da fila).
    as('u_p30');
    expect((await call('GET', '/tournaments/tn_efootball/my-registration')).data).toBeNull();
    expect((await call<RegistrationT>('POST', '/tournaments/tn_efootball/registrations', OK)).data.waitlistPosition).toBe(2);
  });

  it('sair da lista de espera não promove ninguém', async () => {
    as('u_p38');
    expect((await call('DELETE', `/registrations/${idOf('tn_efootball', 'u_p38')}`)).status).toBe(204);
    expect(statusOf('tn_efootball', 'u_p39')).toBe('WAITLIST');
  });

  it('com aprovação manual o promovido aguarda aprovação', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_efootball');
      if (t) t.manualApproval = true;
    });
    as('u_p31');
    await call('DELETE', `/registrations/${idOf('tn_efootball', 'u_p31')}`);
    expect(statusOf('tn_efootball', 'u_p38')).toBe('PENDING_APPROVAL');
  });

  it('depois da abertura do check-in o cancelamento é recusado', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_efootball');
      if (t) t.startsAt = new Date(Date.now() + 10 * 60_000).toISOString(); // check-in abre 30 min antes
    });
    as('u_p30');
    const res = await call('DELETE', `/registrations/${idOf('tn_efootball', 'u_p30')}`);
    expect(res.status).toBe(409);
    expect(res.code).toBe('CANCELLATION_CLOSED');
    expect(statusOf('tn_efootball', 'u_p30')).toBe('CONFIRMED');
  });

  it('squad promovido incompleto fica aguardando membros com a vaga reservada por 24 h; se não completar, volta ao fim da fila', async () => {
    // Deixa a Copa Nova FF cheia (12 vagas, 12 squads) e põe o Alfa e depois o Squad Naja (t_13) na lista de espera.
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_copa_ff');
      if (t) t.maxParticipants = 12;
    });
    as('u_lucas');
    const alfa = await call<RegistrationT>('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    expect(alfa.data.status).toBe('WAITLIST');
    const najaCaptain = db().teams.find((x) => x.id === 't_13')?.captainId ?? '';
    as(najaCaptain);
    const naja = await call<RegistrationT>('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_13' });
    expect(naja.data.waitlistPosition).toBe(2);

    // O capitão do Squad Bravo cancela: o Alfa sobe, mas ainda só tem o capitão confirmado.
    const bravo = db().registrations.find((r) => r.tournamentId === 'tn_copa_ff' && r.teamId === 't_1');
    as('u_p04');
    expect((await call('DELETE', `/registrations/${bravo?.id}`)).status).toBe(204);
    const promoted = db().registrations.find((r) => r.id === alfa.data.id);
    expect(promoted?.status).toBe('PENDING_MEMBERS');
    const reservedMs = Date.parse(promoted?.reservedUntil ?? '') - Date.now();
    expect(reservedMs).toBeGreaterThan(23 * HOUR);
    expect(reservedMs).toBeLessThanOrEqual(24 * HOUR);
    expect(db().registrations.find((r) => r.id === naja.data.id)?.status).toBe('WAITLIST');

    // 24 h depois sem completar: a vaga passa para o próximo e o Alfa volta ao fim da fila.
    mutate((d) => {
      const r = d.registrations.find((x) => x.id === alfa.data.id);
      if (r) r.reservedUntil = new Date(Date.now() - 1000).toISOString();
    });
    as('u_lucas');
    const back = await call<RegistrationT>('GET', '/tournaments/tn_copa_ff/my-registration');
    expect(back.data.status).toBe('WAITLIST');
    expect(back.data.reservedUntil).toBeNull();
    expect(back.data.waitlistPosition).toBe(1); // o Naja saiu da fila: foi promovido
    const najaNow = db().registrations.find((r) => r.id === naja.data.id);
    expect(najaNow?.status).toBe('PENDING_MEMBERS');
    expect(najaNow?.reservedUntil).not.toBeNull();
  });

  it('squad promovido que completa dentro do prazo é confirmado e perde a marca de reserva', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_copa_ff');
      if (t) t.maxParticipants = 12;
    });
    as('u_lucas');
    const alfa = await call<RegistrationT>('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
    as('u_p04');
    await call('DELETE', `/registrations/${db().registrations.find((r) => r.tournamentId === 'tn_copa_ff' && r.teamId === 't_1')?.id}`);
    for (const u of ['u_p01', 'u_p02', 'u_p03']) {
      as(u);
      await call('POST', `/registrations/${alfa.data.id}/confirm`);
    }
    const r = db().registrations.find((x) => x.id === alfa.data.id);
    expect(r?.status).toBe('CONFIRMED');
    expect(r?.reservedUntil).toBeNull();
  });
});

describe('minhas inscrições', () => {
  it('GET /tournaments/:id/my-registration: visitante recebe null; membro do squad inscrito vê a inscrição do squad', async () => {
    as(null);
    const anon = await call('GET', '/tournaments/arena-contra-squad-4v4/my-registration');
    expect(anon.status).toBe(200);
    expect(anon.data).toBeNull();
    as('u_p02'); // membro (não capitão) do Squad Alfa, inscrito no Contra Squad
    const mine = await call<RegistrationT>('GET', '/tournaments/arena-contra-squad-4v4/my-registration');
    expect(Registration.parse(mine.data).teamId).toBe('t_alfa');
    as('u_bianca');
    expect((await call('GET', '/tournaments/arena-contra-squad-4v4/my-registration')).data).toBeNull();
  });

  it('GET /tournaments/:id/registration-eligibility diz quem é da organização', async () => {
    as('u_camila');
    expect((await call('GET', '/tournaments/tn_copa_ff/registration-eligibility')).data).toEqual({ isOrganizer: true });
    as('u_p06');
    expect((await call('GET', '/tournaments/tn_copa_ff/registration-eligibility')).data).toEqual({ isOrganizer: true });
    as('u_ana'); // Admin que não é da equipe do campeonato pode se inscrever
    expect((await call('GET', '/tournaments/tn_copa_ff/registration-eligibility')).data).toEqual({ isOrganizer: false });
    as(null);
    expect((await call('GET', '/tournaments/tn_copa_ff/registration-eligibility')).data).toEqual({ isOrganizer: false });
  });

  it('GET /me/registrations exige login, lista ativas primeiro e traz a próxima partida e a colocação final (F2)', async () => {
    as(null);
    expect((await call('GET', '/me/registrations')).status).toBe(401);
    as('u_bianca');
    const res = await call('GET', '/me/registrations');
    const entries = z.array(MyTournamentEntry).parse(res.data);
    expect(entries.map((e) => e.tournament.slug)).toEqual(['liga-semanal-clash-royale', 'open-8-ball-pool']);
    // Liga em andamento: a partida das quartas da Bianca, com check-in aberto. Open finalizado: 1º lugar no pódio.
    const [liga, open] = entries;
    expect(liga?.nextMatch).toMatchObject({ label: 'Mata-mata · Quartas de final', opponent: 'BrunoPro7', checkInOpen: true });
    expect(liga?.nextMatch?.scheduledAt).not.toBeNull();
    expect(liga?.finalPlacement).toBeNull();
    expect(open?.nextMatch).toBeNull();
    expect(open?.finalPlacement).toBe(1);
  });

  it('membro de squad vê as inscrições do squad em "Meus campeonatos"', async () => {
    as('u_p01');
    const entries = z.array(MyTournamentEntry).parse((await call('GET', '/me/registrations')).data);
    expect(entries.map((e) => e.tournament.slug)).toContain('arena-contra-squad-4v4');
    expect(entries.find((e) => e.tournament.slug === 'arena-contra-squad-4v4')?.registration.displayName).toBe('Squad Alfa');
  });
});
