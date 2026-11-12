/** Regras de squad e convite aplicadas pela API simulada (PRD §12.1). */
import { InviteCandidate, Team, TeamInvite, TeamInvitePreview, type Team as TeamT, type TeamInvite as TeamInviteT, type TeamInvitePreview as PreviewT } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '@/mocks/db';
import { as, call, mutate, setupMockApi } from '@/features/registrations/test/mockApi';
import { INVITE_ATTEMPT_LIMIT } from './lib/rules';

setupMockApi();

const HOUR = 3_600_000;
const nick = (userId: string) => db().users.find((u) => u.id === userId)?.nickname ?? '';

describe('squads', () => {
  it('quem cria vira capitão; a tag é guardada em maiúsculas', async () => {
    as('u_bianca');
    const res = await call<TeamT>('POST', '/teams', { name: 'Squad Ômega', tag: 'omg' });
    expect(res.status).toBe(201);
    const team = Team.parse(res.data);
    expect(team.tag).toBe('OMG');
    expect(team.captainId).toBe('u_bianca');
    expect(team.members).toMatchObject([{ userId: 'u_bianca', role: 'CAPTAIN', isSub: false }]);
    const mine = z.array(Team).parse((await call('GET', '/teams/mine')).data);
    expect(mine.map((t) => t.name)).toEqual(['Squad Ômega']);
  });

  it('tag repetida (sem diferenciar maiúsculas) dá 409 com erro no campo', async () => {
    as('u_bianca');
    const res = await call<{ errors?: Record<string, string> }>('POST', '/teams', { name: 'Outro Alfa', tag: 'alfa' });
    expect(res.status).toBe(409);
    expect(res.code).toBe('TAG_TAKEN');
    expect(res.data.errors?.tag).toMatch(/tag/);
  });

  it('valida nome, tag e logo', async () => {
    as('u_bianca');
    expect((await call('POST', '/teams', { name: 'X', tag: 'TAGLONGA' })).code).toBe('VALIDATION');
    const logo = await call<{ errors?: Record<string, string> }>('POST', '/teams', { name: 'Squad Logo', tag: 'LOGO', logoUrl: 'data:text/html;base64,PGI+' });
    expect(logo.status).toBe(400);
    expect(logo.data.errors?.logoUrl).toBeDefined();
    expect((await call('POST', '/teams', { name: 'Squad Logo', tag: 'LOGO', logoUrl: 'data:image/png;base64,iVBORw0KGgo=' })).status).toBe(201);
  });

  it('GET /teams/mine exige login e traz os convites pendentes só para o capitão', async () => {
    as(null);
    expect((await call('GET', '/teams/mine')).status).toBe(401);
    as('u_lucas');
    const captain = z.array(Team).parse((await call('GET', '/teams/mine')).data);
    expect(captain[0]?.pendingInvites.map((i) => i.code)).toEqual(['ALFA42']);
    as('u_p01');
    const member = z.array(Team).parse((await call('GET', '/teams/mine')).data);
    expect(member[0]?.name).toBe('Squad Alfa');
    expect(member[0]?.pendingInvites).toEqual([]);
    expect(Team.parse((await call('GET', '/teams/t_alfa')).data).pendingInvites).toEqual([]);
  });

  it('só o capitão edita; a tag continua única', async () => {
    as('u_p01');
    expect((await call('PATCH', '/teams/t_alfa', { name: 'Hackeado' })).status).toBe(403);
    as('u_lucas');
    expect(Team.parse((await call('PATCH', '/teams/t_alfa', { name: 'Alfa Prime' })).data).name).toBe('Alfa Prime');
    expect((await call('PATCH', '/teams/t_alfa', { tag: 'brav' })).code).toBe('TAG_TAKEN');
    expect((await call('PATCH', '/teams/t_alfa', { tag: 'alfa' })).status).toBe(200); // a própria tag não conflita
  });

  it('excluir é bloqueado com inscrição ativa em campeonato não encerrado', async () => {
    as('u_lucas'); // o Alfa está confirmado no Contra Squad (inscrições abertas)
    const blocked = await call('DELETE', '/teams/t_alfa');
    expect(blocked.status).toBe(409);
    expect(blocked.code).toBe('TEAM_HAS_ACTIVE_REGISTRATION');
    expect(blocked.detail).toContain('Arena Contra Squad 4v4');

    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_contra_squad');
      if (t) t.status = 'FINISHED';
    });
    as('u_p01');
    expect((await call('DELETE', '/teams/t_alfa')).status).toBe(403);
    as('u_lucas');
    expect((await call('DELETE', '/teams/t_alfa')).status).toBe(204);
    expect(db().teams.some((t) => t.id === 't_alfa')).toBe(false);
    expect(db().teamInvites.find((i) => i.code === 'ALFA42')?.status).toBe('REVOKED');
    // O histórico guarda o nome do squad excluído.
    expect(db().registrations.find((r) => r.teamId === 't_alfa')).toMatchObject({ importedName: 'Squad Alfa', importedTag: 'ALFA' });
  });
});

describe('membros', () => {
  it('capitão marca e desmarca reserva; membro não', async () => {
    as('u_p01');
    expect((await call('PATCH', '/teams/t_alfa/members/u_p02', { isSub: true })).status).toBe(403);
    as('u_lucas');
    const team = Team.parse((await call('PATCH', '/teams/t_alfa/members/u_p02', { isSub: true })).data);
    expect(team.members.find((m) => m.userId === 'u_p02')?.isSub).toBe(true);
  });

  it('capitão só sai depois de transferir a capitania', async () => {
    as('u_lucas');
    const res = await call('DELETE', '/teams/t_alfa/members/u_lucas');
    expect(res.status).toBe(409);
    expect(res.code).toBe('CAPTAIN_MUST_TRANSFER');
  });

  it('transferir capitania troca os papéis; só o capitão transfere, e só para um membro', async () => {
    as('u_p01');
    expect((await call('POST', '/teams/t_alfa/transfer-captain', { userId: 'u_p01' })).status).toBe(403);
    as('u_lucas');
    expect((await call('POST', '/teams/t_alfa/transfer-captain', { userId: 'u_bianca' })).code).toBe('NOT_A_MEMBER');
    const res = await call<TeamT>('POST', '/teams/t_alfa/transfer-captain', { userId: 'u_p01' });
    expect(res.status).toBe(200);
    expect(res.data.captainId).toBe('u_p01');
    expect(res.data.members.find((m) => m.userId === 'u_p01')?.role).toBe('CAPTAIN');
    expect(res.data.members.find((m) => m.userId === 'u_lucas')?.role).toBe('MEMBER');
    expect(res.data.pendingInvites).toEqual([]); // quem deixou de ser capitão não vê mais os códigos
    expect((await call('PATCH', '/teams/t_alfa', { name: 'Ainda meu' })).status).toBe(403);
  });

  it('quem está escalado numa inscrição ativa não sai nem é removido; fora disso, sai e é removido', async () => {
    as('u_p03'); // escalado no Contra Squad pelo Alfa
    const stuck = await call('DELETE', '/teams/t_alfa/members/u_p03');
    expect(stuck.status).toBe(409);
    expect(stuck.code).toBe('MEMBER_IN_ACTIVE_REGISTRATION');

    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_contra_squad');
      if (t) t.status = 'FINISHED';
    });
    expect((await call('DELETE', '/teams/t_alfa/members/u_p02')).status).toBe(403); // membro não remove outro membro
    expect((await call('DELETE', '/teams/t_alfa/members/u_p03')).status).toBe(204); // sai sozinho
    as('u_lucas');
    expect((await call('DELETE', '/teams/t_alfa/members/u_p02')).status).toBe(204); // capitão remove
    expect(db().teams.find((t) => t.id === 't_alfa')?.members.map((m) => m.userId)).toEqual(['u_lucas', 'u_p01']);
  });
});

describe('convites', () => {
  it('por apelido: cria convite dirigido, que expira em 72 h e aparece para o convidado', async () => {
    as('u_lucas');
    const res = await call<TeamInviteT>('POST', '/teams/t_alfa/invites', { kind: 'nickname', nickname: 'bianca' });
    expect(res.status).toBe(201);
    const invite = TeamInvite.parse(res.data);
    expect(invite).toMatchObject({ invitedUserId: 'u_bianca', invitedNickname: 'Bianca', status: 'PENDING', invitedByNickname: 'Lucas' });
    expect(invite.code).toMatch(/^[A-Z0-9]{6}$/);
    const ttl = Date.parse(invite.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(71.9 * HOUR);
    expect(ttl).toBeLessThanOrEqual(72 * HOUR);

    as('u_bianca');
    const mine = z.array(TeamInvite).parse((await call('GET', '/me/team-invites')).data);
    expect(mine.map((i) => i.teamName).sort()).toEqual(['Squad Alfa', 'Squad Bravo']);
  });

  it('por apelido: recusa quem não existe, quem já é membro e convite repetido', async () => {
    as('u_lucas');
    expect((await call('POST', '/teams/t_alfa/invites', { kind: 'nickname', nickname: 'ninguem_aqui' })).code).toBe('USER_NOT_FOUND');
    expect((await call('POST', '/teams/t_alfa/invites', { kind: 'nickname', nickname: nick('u_p01') })).code).toBe('ALREADY_MEMBER');
    await call('POST', '/teams/t_alfa/invites', { kind: 'nickname', nickname: 'Bianca' });
    expect((await call('POST', '/teams/t_alfa/invites', { kind: 'nickname', nickname: 'Bianca' })).code).toBe('ALREADY_INVITED');
  });

  it('só o capitão convida e revoga', async () => {
    as('u_p01');
    expect((await call('POST', '/teams/t_alfa/invites', { kind: 'link' })).status).toBe(403);
    expect((await call('DELETE', '/team-invites/ti_1')).status).toBe(403);
    as('u_lucas');
    expect((await call('DELETE', '/team-invites/ti_1')).status).toBe(204);
    as('u_bianca');
    const revoked = await call('POST', '/team-invites/ALFA42/accept');
    expect(revoked.status).toBe(410);
    expect(revoked.code).toBe('INVITE_REVOKED');
    expect(revoked.detail).toMatch(/cancelado pelo capitão/);
  });

  it('prévia pública mostra squad, quem convidou, validade e estado', async () => {
    as(null);
    const valid = TeamInvitePreview.parse((await call('GET', '/team-invites/alfa42')).data);
    expect(valid).toMatchObject({ code: 'ALFA42', state: 'VALID', invitedByNickname: 'Lucas', invitedNickname: null, viewerIsMember: false });
    expect(valid.team).toMatchObject({ name: 'Squad Alfa', tag: 'ALFA', memberCount: 4 });
    expect(TeamInvitePreview.parse((await call('GET', '/team-invites/VELHO1')).data).state).toBe('EXPIRED');
    as('u_p01');
    expect((await call<PreviewT>('GET', '/team-invites/ALFA42')).data.viewerIsMember).toBe(true);
    as('u_lucas');
    expect((await call<PreviewT>('GET', '/team-invites/BRAV07')).data.viewerIsNotInvitee).toBe(true);
  });

  it('aceitar exige login', async () => {
    as(null);
    expect((await call('POST', '/team-invites/ALFA42/accept')).status).toBe(401);
  });

  it('convite expirado é recusado com mensagem clara', async () => {
    as('u_bianca');
    const res = await call('POST', '/team-invites/VELHO1/accept');
    expect(res.status).toBe(410);
    expect(res.code).toBe('INVITE_EXPIRED');
    expect(res.detail).toMatch(/expirou/);
  });

  it('link/código coloca a pessoa no squad e continua valendo para o próximo; quem já é membro é recusado', async () => {
    as('u_bianca');
    const res = await call<TeamT>('POST', '/team-invites/ALFA42/accept');
    expect(res.status).toBe(200);
    expect(res.data.members.map((m) => m.userId)).toContain('u_bianca');
    const again = await call('POST', '/team-invites/ALFA42/accept');
    expect(again.status).toBe(409);
    expect(again.code).toBe('ALREADY_MEMBER');
    as('u_p50');
    expect((await call('POST', '/team-invites/ALFA42/accept')).status).toBe(200);
  });

  it('convite por apelido só vale para o convidado e é de uso único', async () => {
    as('u_lucas');
    const forbidden = await call('POST', '/team-invites/BRAV07/accept');
    expect(forbidden.status).toBe(403);
    expect(forbidden.code).toBe('INVITE_NOT_FOR_YOU');
    as('u_bianca');
    expect((await call('POST', '/team-invites/BRAV07/accept')).status).toBe(200);
    expect(db().teamInvites.find((i) => i.code === 'BRAV07')?.status).toBe('ACCEPTED');
    expect((await call('GET', '/me/team-invites')).data).toEqual([]);
  });

  it('recusar: só o convidado; o convite some dos pendentes', async () => {
    as('u_lucas');
    expect((await call('POST', '/team-invites/BRAV07/decline')).status).toBe(403);
    as('u_bianca');
    expect((await call('POST', '/team-invites/BRAV07/decline')).status).toBe(204);
    expect((await call('GET', '/me/team-invites')).data).toEqual([]);
    const declined = await call('POST', '/team-invites/BRAV07/accept');
    expect(declined.code).toBe('INVITE_DECLINED');
  });

  it('limita as tentativas de código errado: 10 por minuto, depois 429 até para código certo', async () => {
    as('u_p59');
    for (let i = 0; i < INVITE_ATTEMPT_LIMIT; i += 1) {
      const miss = await call('GET', `/team-invites/ZZZZ${String(i).padStart(2, '0')}`);
      expect(miss.status).toBe(404);
      expect(miss.code).toBe('INVITE_NOT_FOUND');
    }
    const blocked = await call('GET', '/team-invites/ZZZZ99');
    expect(blocked.status).toBe(429);
    expect(blocked.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await call('POST', '/team-invites/ALFA42/accept')).status).toBe(429);
    // O limite é por conta: outra pessoa continua conseguindo.
    as('u_p58');
    expect((await call('GET', '/team-invites/ALFA42')).status).toBe(200);
  });
});

describe('GET /user-search', () => {
  it('exige login e pelo menos 2 caracteres', async () => {
    as(null);
    expect((await call('GET', '/user-search?q=bi')).status).toBe(401);
    as('u_lucas');
    expect((await call('GET', '/user-search?q=b')).status).toBe(400);
  });

  it('devolve até 8 resultados só com id, apelido e avatar, sem a própria pessoa', async () => {
    as('u_lucas');
    const res = await call<Record<string, unknown>[]>('GET', '/user-search?q=ka');
    const list = z.array(InviteCandidate).parse(res.data);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(8);
    for (const item of res.data) expect(Object.keys(item).sort()).toEqual(['avatarUrl', 'id', 'nickname']);
    expect(list.every((u) => u.nickname.toLowerCase().includes('ka'))).toBe(true);

    const self = z.array(InviteCandidate).parse((await call('GET', '/user-search?q=luc')).data);
    expect(self.some((u) => u.id === 'u_lucas')).toBe(false);
    expect((await call<unknown[]>('GET', '/user-search?q=an')).data.length).toBeLessThanOrEqual(8);
  });
});
