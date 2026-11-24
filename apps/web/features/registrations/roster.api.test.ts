/** Elenco do squad e avisos do fluxo de inscrição na API simulada (espelho de `packages/api/.../roster.ts`). */
import { AcceptTeamInviteResult, RosterChangeResult, type Registration as RegistrationT } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { db } from '@/mocks/db';
import { notifications } from '@/mocks/notify';
import { as, call, mutate, setupMockApi } from './test/mockApi';

setupMockApi();

const OK = { acceptRules: true };
const notesOf = (userId: string, type: string) => notifications().filter((n) => n.userId === userId && n.type === type);

async function registerAlfa(): Promise<string> {
  as('u_lucas');
  const res = await call<RegistrationT>('POST', '/tournaments/tn_copa_ff/registrations', { ...OK, teamId: 't_alfa' });
  expect(res.status).toBe(201);
  return res.data.id;
}
const regOf = (teamId: string) => db().registrations.find((r) => r.tournamentId === 'tn_copa_ff' && r.teamId === teamId);

describe('avisos do fluxo de inscrição', () => {
  it('squad inscrito: o elenco recebe "Confirme sua participação"; ao completar, todos recebem "Inscrição confirmada"', async () => {
    const id = await registerAlfa();
    expect(notesOf('u_p01', 'TEAM_INVITE').at(-1)).toMatchObject({ title: 'Confirme sua participação em Copa Nova FF — Squad', link: '/c/copa-nova-ff-squad' });
    expect(notesOf('u_lucas', 'TEAM_INVITE').some((n) => n.title.startsWith('Confirme'))).toBe(false);
    for (const u of ['u_p01', 'u_p02', 'u_p03']) {
      as(u);
      await call('POST', `/registrations/${id}/confirm`);
    }
    expect(notesOf('u_p02', 'REGISTRATION_CONFIRMED')).toHaveLength(1);
  });

  it('convite por apelido avisa o convidado com o link do convite', async () => {
    as('u_lucas');
    const invite = await call<{ code: string }>('POST', '/teams/t_alfa/invites', { kind: 'nickname', nickname: 'Bianca' });
    expect(notesOf('u_bianca', 'TEAM_INVITE').at(-1)).toMatchObject({ title: 'Convite para o Squad Alfa', link: `/squads/convite/${invite.data.code}` });
  });
});

describe('elenco do squad', () => {
  it('membro recusa; quem entra pelo link do squad entra no elenco confirmado e o squad completa', async () => {
    const id = await registerAlfa();
    for (const u of ['u_p01', 'u_p02']) {
      as(u);
      await call('POST', `/registrations/${id}/confirm`);
    }
    as('u_p03');
    expect((await call('POST', `/registrations/${id}/decline`)).status).toBe(204);
    as('u_bianca');
    mutate((d) => {
      const bianca = d.users.find((u) => u.id === 'u_bianca');
      if (bianca && !bianca.gameAccounts.some((a) => a.gameId === 'g_freefire')) bianca.gameAccounts.push({ gameId: 'g_freefire', fields: { playerId: '123456789', nick: 'Bia' }, updatedAt: new Date().toISOString() });
    });
    const joined = AcceptTeamInviteResult.parse((await call('POST', '/team-invites/ALFA42/accept')).data);
    expect(joined.rosters).toEqual([{ registrationId: id, tournamentId: 'tn_copa_ff', tournamentName: 'Copa Nova FF — Squad', tournamentSlug: 'copa-nova-ff-squad', confirmed: true }]);
    expect(db().registrations.find((r) => r.id === id)?.status).toBe('CONFIRMED');
    expect(notesOf('u_lucas', 'TEAM_INVITE').some((n) => n.title === 'Novo jogador no Squad Alfa')).toBe(true);
  });

  it('capitão escala e tira membros do squad até a trava; membro comum não mexe', async () => {
    const id = await registerAlfa();
    as('u_lucas');
    expect(RosterChangeResult.parse((await call('DELETE', `/registrations/${id}/members/u_p03`)).data).registrations[0]?.members).toHaveLength(3);
    expect((await call('POST', `/registrations/${id}/members`, { userId: 'u_p03' })).status).toBe(200);
    expect((await call('POST', `/registrations/${id}/members`, { userId: 'u_bianca' })).code).toBe('NOT_A_MEMBER');
    expect((await call('DELETE', `/registrations/${id}/members/u_lucas`)).code).toBe('CAPTAIN_IN_ROSTER');
    as('u_p01');
    expect((await call('DELETE', `/registrations/${id}/members/u_p03`)).code).toBe('NOT_ROSTER_MANAGER');
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_copa_ff');
      if (t) t.rosterLockAt = new Date(Date.now() - 60_000).toISOString();
    });
    as('u_lucas');
    expect((await call('DELETE', `/registrations/${id}/members/u_p03`)).code).toBe('ROSTER_LOCKED');
  });

  it('organização remaneja entre squads, escala pelo apelido e respeita a exclusividade e o limite', async () => {
    const from = regOf('t_1');
    const to = regOf('t_2');
    if (!from || !to) throw new Error('seed sem os squads 1 e 2 na Copa Nova FF');
    const player = from.members.find((m) => m.userId !== db().teams.find((t) => t.id === 't_1')?.captainId)?.userId ?? '';
    as('u_camila');
    const moved = RosterChangeResult.parse((await call('POST', `/registrations/${from.id}/members/${player}/move`, { toRegistrationId: to.id })).data);
    expect(moved.registrations[1]?.members.map((m) => m.userId)).toContain(player);
    // Antes do início: o squad 1 perdeu um titular e volta a aguardar membros (continua com a vaga); o 2 segue confirmado.
    expect(moved.registrations[0]?.status).toBe('PENDING_MEMBERS');
    expect(moved.registrations[1]?.status).toBe('CONFIRMED');
    expect(notesOf(player, 'TEAM_INVITE').at(-1)?.title).toMatch(/^Você foi remanejado/);
    // O squad 2 já tem 4 + 1 reserva: cheio.
    expect((await call('POST', `/registrations/${to.id}/members`, { nickname: 'Lucas' })).code).toBe('ROSTER_FULL');
    // Quem já está em outro squad do campeonato não entra.
    expect((await call('POST', `/registrations/${from.id}/members`, { userId: to.members[0]?.userId })).code).toBe('PLAYER_IN_OTHER_TEAM');
    // Moderador não remaneja.
    as('u_p06');
    expect((await call('POST', `/registrations/${to.id}/members/${player}/move`, { toRegistrationId: from.id })).status).toBe(403);
  });
});
