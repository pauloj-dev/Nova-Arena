/**
 * Convite por link para a equipe do campeonato e reabertura das inscrições (RN-16) na API simulada: os mesmos
 * cenários do teste de integração da API real (`packages/api/test/staff-invites.integration.test.ts`).
 */
import { AcceptStaffInviteResponse, MyStaffTournament, OrganizerTournamentDetail, StaffInvitePreview, TournamentStaff, TournamentStaffInvite } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { notifications } from '../notify';
import { as, call, mutate, setupMockApi } from '../testing';

setupMockApi();

const CAMILA = 'u_camila'; // dona da Copa Nova FF Squad
const BIANCA = 'u_bianca';
const LUCAS = 'u_lucas';
const COPA = 'tn_copa_ff';
const DAY = 24 * 3600_000;

async function createInvite(body: { role: 'CO_ORGANIZER' | 'MODERATOR'; validity: '1h' | '24h' | '7d'; maxUses: number }) {
  as(CAMILA);
  const res = await call('POST', `/tournaments/${COPA}/staff-invites`, body);
  expect(res.status, JSON.stringify(res.data)).toBe(201);
  const invite = TournamentStaffInvite.parse(res.data);
  return { invite, token: invite.link?.split('/equipe/convite/')[1] ?? '' };
}

describe('convite por link para a equipe do evento', () => {
  it('a dona cria o link; a pessoa vê a prévia sem login, aceita e entra na equipe; quem convidou é avisado', async () => {
    const { invite, token } = await createInvite({ role: 'MODERATOR', validity: '24h', maxUses: 1 });
    expect(invite.link).toMatch(/^http:\/\/localhost:3000\/equipe\/convite\/[0-9a-f]{48}$/);
    expect(invite).toMatchObject({ role: 'MODERATOR', state: 'VALID', uses: 0, maxUses: 1 });

    as(null);
    const preview = StaffInvitePreview.parse((await call('GET', `/staff-invites/${token}`)).data);
    expect(preview).toMatchObject({ role: 'MODERATOR', state: 'VALID', invitedBy: 'Camila', tournament: { id: COPA } });
    expect((await call('POST', `/staff-invites/${token}/accept`)).status).toBe(401);

    as(LUCAS);
    const accepted = await call('POST', `/staff-invites/${token}/accept`);
    expect(accepted.status, JSON.stringify(accepted.data)).toBe(200);
    expect(AcceptStaffInviteResponse.parse(accepted.data)).toMatchObject({ tournamentId: COPA, role: 'MODERATOR' });
    expect((await call('GET', `/organizer/tournaments/${COPA}`)).status).toBe(200);
    expect(z.array(MyStaffTournament).parse((await call('GET', '/me/staff-tournaments')).data)).toEqual([expect.objectContaining({ id: COPA, role: 'MODERATOR' })]);
    expect(notifications().some((n) => n.userId === CAMILA && n.title.includes('entrou na equipe'))).toBe(true);

    as(CAMILA);
    const staff = z.array(TournamentStaff).parse((await call('GET', `/tournaments/${COPA}/staff`)).data);
    expect(staff.map((s) => s.userId)).toContain(LUCAS);
    // Um uso só: esgotou.
    as(BIANCA);
    const again = await call('POST', `/staff-invites/${token}/accept`);
    expect([again.status, again.code]).toEqual([410, 'INVITE_EXHAUSTED']);
  });

  it('só a dona (ou o Admin) cria, lista e revoga; link revogado ou expirado não vale', async () => {
    as(BIANCA);
    expect((await call('POST', `/tournaments/${COPA}/staff-invites`, { role: 'MODERATOR', validity: '1h', maxUses: 1 })).status).toBe(403);
    expect((await call('GET', `/tournaments/${COPA}/staff-invites`)).status).toBe(403);

    const { invite, token } = await createInvite({ role: 'CO_ORGANIZER', validity: '7d', maxUses: 3 });
    const list = z.array(TournamentStaffInvite).parse((await call('GET', `/tournaments/${COPA}/staff-invites`)).data);
    expect(list.find((i) => i.id === invite.id)).toMatchObject({ link: null, state: 'VALID' });
    const revoked = await call('DELETE', `/tournaments/${COPA}/staff-invites/${invite.id}`);
    expect(TournamentStaffInvite.parse(revoked.data).state).toBe('REVOKED');
    as(BIANCA);
    const res = await call('POST', `/staff-invites/${token}/accept`);
    expect([res.status, res.code]).toEqual([410, 'INVITE_REVOKED']);

    const expired = await createInvite({ role: 'MODERATOR', validity: '1h', maxUses: 1 });
    mutate((d) => {
      const row = (d.extra.staffInvites as { id: string; expiresAt: string }[]).find((i) => i.id === expired.invite.id);
      if (row) row.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    as(BIANCA);
    expect((await call('POST', `/staff-invites/${expired.token}/accept`)).code).toBe('INVITE_EXPIRED');
    expect((await call('GET', '/staff-invites/nao-existe-123456')).status).toBe(404);
  });

  it('quem está inscrito no campeonato não entra na equipe', async () => {
    const { token } = await createInvite({ role: 'MODERATOR', validity: '24h', maxUses: 5 });
    let registered = '';
    mutate((d) => {
      const r = d.registrations.find((x) => x.tournamentId === COPA && ['CONFIRMED', 'PENDING_MEMBERS', 'WAITLIST'].includes(x.status));
      registered = r?.userId ?? r?.members[0]?.userId ?? '';
    });
    expect(registered).not.toBe('');
    as(registered);
    expect((await call('POST', `/staff-invites/${token}/accept`)).code).toBe('STAFF_IS_REGISTERED');
  });

  it('o link de demonstração abre a prévia', async () => {
    as(null);
    const res = await call('GET', '/staff-invites/convite-equipe-valido');
    expect(StaffInvitePreview.parse(res.data)).toMatchObject({ state: 'VALID', role: 'MODERATOR', tournament: { id: COPA } });
  });
});

describe('reabrir as inscrições (RN-16)', () => {
  it('encerradas: reabre com a nova data de fechamento; sem a data, pede a data', async () => {
    as(CAMILA);
    expect((await call('POST', `/tournaments/${COPA}/close-registration`)).status).toBe(200);
    const noDate = await call('POST', `/tournaments/${COPA}/open-registration`);
    expect([noDate.status, noDate.code]).toEqual([409, 'REGISTRATION_DEADLINE_PASSED']);
    const past = await call('POST', `/tournaments/${COPA}/open-registration`, { registrationClosesAt: new Date(Date.now() - DAY).toISOString() });
    expect(past.status).toBe(400);
    const detail = OrganizerTournamentDetail.parse((await call('GET', `/organizer/tournaments/${COPA}`)).data);
    const closesAt = new Date(Math.min(Date.now() + DAY, new Date(detail.startsAt ?? Date.now() + 2 * DAY).getTime() - 3600_000)).toISOString();
    const ok = await call('POST', `/tournaments/${COPA}/open-registration`, { registrationClosesAt: closesAt });
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    expect(OrganizerTournamentDetail.parse(ok.data)).toMatchObject({ status: 'REGISTRATION_OPEN', registrationClosesAt: closesAt });
  });
});
