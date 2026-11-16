/**
 * Inscrições contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI) — issue #79.
 * Critérios de aceite: CT-02 (100 inscrições simultâneas para 10 vagas → 10 confirmadas e 90 na lista de
 * espera) e "cancelamento promove o primeiro da lista".
 */
import { createDb, type PrismaClient } from '@nova/db';
import { ImportRegistrationsResult, MyTournamentEntry, Problem, Registration, ReviewRegistrationResult } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('inscrições (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-7);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let soloGame = { id: '', modeId: '', modelId: '' };
  let squadGame = { id: '', modeId: '', modelId: '' };

  async function makeUsers(keys: string[]) {
    await db.user.createMany({ data: keys.map((k) => ({ email: `rg.${k}.${stamp}@exemplo.com`, nickname: `rg${k}${stamp}`.slice(0, 20), nicknameKey: `rg${k}${stamp}`.slice(0, 20).toLowerCase() })) });
    const users = await db.user.findMany({ where: { email: { in: keys.map((k) => `rg.${k}.${stamp}@exemplo.com`) } } });
    await db.userRole.createMany({ data: users.map((u) => ({ userId: u.id, role: 'PARTICIPANT' as const })) });
    for (const u of users) {
      const key = u.email.split('.')[1] ?? '';
      const session = await db.session.create({ data: { userId: u.id, familyId: randomUUID(), refreshTokenHash: `rg-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
      cookies.set(key, `na_at=${await signAccessToken(env, { sub: u.id, sid: session.id, sv: 0, tfa: false, roles: ['PARTICIPANT'] }, new Date())}`);
      ids.set(key, u.id);
    }
  }

  const call = async (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(who ? { Cookie: cookies.get(who) ?? '' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // CSV
    }
    return { status: res.status, data, headers: res.headers };
  };
  const code = (data: unknown) => Problem.parse(data).code;
  const register = (who: string, tournamentId: string, teamId?: string) => call(who, `/tournaments/${tournamentId}/registrations`, { method: 'POST', body: { acceptRules: true, ...(teamId ? { teamId } : {}) } });

  async function tournament(game: { id: string; modeId: string; modelId: string }, opts: { max: number; type: 'SOLO' | 'TEAM'; manualApproval?: boolean; waitlistEnabled?: boolean; owner?: string }) {
    const slug = `copa-rg-${stamp}-${randomUUID().slice(0, 6)}`;
    const t = await db.tournament.create({
      data: { slug, name: 'Copa Inscrições', gameId: game.id, gameModeId: game.modeId, ownerId: ids.get(opts.owner ?? 'dono') ?? '', status: 'REGISTRATION_OPEN', participantType: opts.type, maxParticipants: opts.max, manualApproval: opts.manualApproval ?? false, waitlistEnabled: opts.waitlistEnabled ?? true },
    });
    await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Chave', format: 'SINGLE_ELIM', scoringModelId: game.modelId, tiebreakers: ['points'] } });
    return t;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 10 });
    app = createApp({ env, deps: { db: () => db } });
    const solo = await db.game.create({
      data: { slug: `rg-solo-${stamp}`, name: `Solo ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    soloGame = { id: solo.id, modeId: solo.modes[0]?.id ?? '', modelId: solo.scoringModels[0]?.id ?? '' };
    const squad = await db.game.create({
      data: {
        slug: `rg-squad-${stamp}`,
        name: `Squad ${stamp}`,
        requiredAccountFields: [{ key: 'playerId', label: 'ID' }],
        modes: { create: { name: '2x2', teamSize: 2, maxSubs: 1, matchType: 'TEAM_VS_TEAM' } },
        scoringModels: { create: { name: 'V', matchType: 'TEAM_VS_TEAM', rules: DUEL_RULES, tiebreakers: ['points'] } },
      },
      include: { modes: true, scoringModels: true },
    });
    squadGame = { id: squad.id, modeId: squad.modes[0]?.id ?? '', modelId: squad.scoringModels[0]?.id ?? '' };
    await makeUsers(['dono', 'mod', 'a', 'b', 'c', 'd', 'e', 'f', ...Array.from({ length: 100 }, (_, i) => `p${i}`)]);
    await db.userRole.create({ data: { userId: ids.get('dono') ?? '', role: 'ORGANIZER' } });
  }, 60_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  it('CT-02: 100 inscrições simultâneas para 10 vagas → 10 confirmadas e 90 na lista de espera', async () => {
    const t = await tournament(soloGame, { max: 10, type: 'SOLO' });
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => register(`p${i}`, t.id)));
    expect(results.filter((r) => r.status !== 201).map((r) => r.data)).toEqual([]);
    const statuses = await db.registration.groupBy({ by: ['status'], where: { tournamentId: t.id }, _count: { _all: true } });
    expect(Object.fromEntries(statuses.map((s) => [s.status, s._count._all]))).toEqual({ CONFIRMED: 10, WAITLIST: 90 });
    // A fila tem posições 1..90, sem buraco nem repetição.
    const list = z.array(Registration).parse((await call('dono', `/tournaments/${t.id}/registrations?scope=all`)).data);
    expect(list.filter((r) => r.status === 'WAITLIST').map((r) => r.waitlistPosition).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
  }, 60_000);

  it('Cancelamento promove o primeiro da lista', async () => {
    const t = await tournament(soloGame, { max: 2, type: 'SOLO' });
    const first = Registration.parse((await register('a', t.id)).data);
    await register('b', t.id);
    const third = Registration.parse((await register('c', t.id)).data);
    await register('d', t.id);
    expect(third).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });

    expect((await call('b', `/registrations/${first.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call('a', `/registrations/${first.id}`, { method: 'DELETE' })).status).toBe(204);
    const promoted = Registration.parse((await call('c', `/tournaments/${t.id}/my-registration`)).data);
    expect(promoted).toMatchObject({ status: 'CONFIRMED', waitlistPosition: null });
    expect(Registration.parse((await call('d', `/tournaments/${t.id}/my-registration`)).data).waitlistPosition).toBe(1);

    // Quem cancelou pode se inscrever de novo (entra no fim da fila).
    expect(Registration.parse((await register('a', t.id)).data)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 2 });
    expect(code((await register('a', t.id)).data)).toBe('ALREADY_REGISTERED');
  });

  it('organizador não se inscreve; inscrições fechadas, sem fila ou recusado: 409', async () => {
    const t = await tournament(soloGame, { max: 1, type: 'SOLO', waitlistEnabled: false });
    expect(code((await register('dono', t.id)).data)).toBe('OWN_TOURNAMENT');
    expect((await call('dono', `/tournaments/${t.id}/registration-eligibility`)).data).toEqual({ isOrganizer: true });
    expect((await call('e', `/tournaments/${t.id}/registration-eligibility`)).data).toEqual({ isOrganizer: false });
    await register('e', t.id);
    expect(code((await register('f', t.id)).data)).toBe('TOURNAMENT_FULL');

    await db.tournament.update({ where: { id: t.id }, data: { status: 'REGISTRATION_CLOSED' } });
    expect(code((await register('f', t.id)).data)).toBe('REGISTRATION_CLOSED');
    expect((await call(null, `/tournaments/${t.id}/my-registration`)).data).toBeNull();
  });

  it('squad: capitão inscreve, ID do jogo obrigatório, membros confirmam; um jogador não joga por dois squads', async () => {
    const t = await tournament(squadGame, { max: 4, type: 'TEAM' });
    const team = await db.team.create({ data: { name: 'Squad Rg', tag: `R${stamp.slice(-3)}`, captainId: ids.get('a') ?? '', members: { create: [{ userId: ids.get('a') ?? '', role: 'CAPTAIN' }, { userId: ids.get('b') ?? '' }] } } });
    const other = await db.team.create({ data: { name: 'Squad Rh', tag: `H${stamp.slice(-3)}`, captainId: ids.get('c') ?? '', members: { create: [{ userId: ids.get('c') ?? '', role: 'CAPTAIN' }, { userId: ids.get('b') ?? '' }] } } });

    expect(code((await register('b', t.id, team.id)).data)).toBe('NOT_CAPTAIN');
    expect(code((await register('a', t.id)).data)).toBe('TEAM_REQUIRED');
    expect(code((await register('a', t.id, team.id)).data)).toBe('GAME_ACCOUNT_REQUIRED');
    await db.gameAccount.createMany({ data: ['a', 'b', 'c'].map((k) => ({ userId: ids.get(k) ?? '', gameId: squadGame.id, fields: { playerId: '1' } })) });

    const reg = Registration.parse((await register('a', t.id, team.id)).data);
    expect(reg).toMatchObject({ status: 'PENDING_MEMBERS', requiredMembers: 2 });
    expect(reg.members.map((m) => [m.isCaptain, m.confirmedAt !== null])).toEqual([
      [true, true],
      [false, false],
    ]);
    // "b" já está no elenco do Squad Rg: o Squad Rh não entra com ele.
    expect(code((await register('c', t.id, other.id)).data)).toBe('PLAYER_IN_OTHER_TEAM');

    const confirmed = Registration.parse((await call('b', `/registrations/${reg.id}/confirm`, { method: 'POST' })).data);
    expect(confirmed.status).toBe('CONFIRMED');
    const mine = z.array(MyTournamentEntry).parse((await call('b', '/me/registrations')).data);
    expect(mine.map((e) => e.registration.id)).toContain(reg.id);
  });

  it('organização: aprova, recusa e substitui; moderador não remove; promoção na recusa', async () => {
    const t = await tournament(soloGame, { max: 1, type: 'SOLO', manualApproval: true });
    await db.tournamentStaff.create({ data: { tournamentId: t.id, userId: ids.get('mod') ?? '', role: 'MODERATOR', addedById: ids.get('dono') ?? '' } });
    const ra = Registration.parse((await register('a', t.id)).data);
    const rb = Registration.parse((await register('b', t.id)).data);
    const rc = Registration.parse((await register('c', t.id)).data);
    expect([ra.status, rb.status, rc.status]).toEqual(['PENDING_APPROVAL', 'WAITLIST', 'WAITLIST']);

    expect(code((await call('mod', `/registrations/${ra.id}`, { method: 'PATCH', body: { action: 'remove', reason: 'Fora do regulamento' } })).data)).toBe('FORBIDDEN');
    expect((await call('a', `/registrations/${rb.id}`, { method: 'PATCH', body: { action: 'approve' } })).status).toBe(403);

    // Moderador recusa: a vaga vai para o primeiro da fila (que, com aprovação manual, aguarda aprovação).
    const rejected = ReviewRegistrationResult.parse((await call('mod', `/registrations/${ra.id}`, { method: 'PATCH', body: { action: 'reject', reason: 'Nick ofensivo' } })).data);
    expect(rejected.registration).toMatchObject({ status: 'REJECTED', statusReason: 'Nick ofensivo' });
    expect(rejected.promoted.map((p) => [p.id, p.status])).toEqual([[rb.id, 'PENDING_APPROVAL']]);
    expect(code((await register('a', t.id)).data)).toBe('REGISTRATION_REJECTED');

    const approved = ReviewRegistrationResult.parse((await call('dono', `/registrations/${rb.id}`, { method: 'PATCH', body: { action: 'approve' } })).data);
    expect(approved.registration.status).toBe('CONFIRMED');
    const replaced = ReviewRegistrationResult.parse((await call('dono', `/registrations/${rb.id}`, { method: 'PATCH', body: { action: 'replace', withRegistrationId: rc.id } })).data);
    expect(replaced.registration).toMatchObject({ status: 'CANCELLED', statusReason: `Substituída por rgc${stamp}.` });
    expect(Registration.parse((await call('c', `/tournaments/${t.id}/my-registration`)).data).status).toBe('CONFIRMED');
    expect(await db.auditLog.count({ where: { tournamentId: t.id, action: 'REGISTRATION_REVIEWED' } })).toBe(3);
  });

  it('importar CSV (excedente na fila, repetidos pulados) e exportar CSV para o Excel', async () => {
    const t = await tournament(soloGame, { max: 2, type: 'SOLO' });
    const imported = ImportRegistrationsResult.parse(
      (await call('dono', `/tournaments/${t.id}/registrations/import`, { method: 'POST', body: { rows: [{ name: 'Time Um', tag: 'um', contact: 'um@exemplo.com' }, { name: 'Time Dois' }, { name: 'time um' }, { name: 'Time Três', gameId: '123' }] } })).data,
    );
    expect(imported).toEqual({ created: 2, waitlisted: 1, skipped: [{ row: 3, reason: 'Já existe um inscrito chamado "time um" neste campeonato.' }] });
    expect((await call('a', `/tournaments/${t.id}/registrations/import`, { method: 'POST', body: { rows: [{ name: 'X' }] } })).status).toBe(403);

    const csv = await call('dono', `/tournaments/${t.id}/registrations.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    // `text()` tira o BOM ao decodificar: confere nos bytes que o arquivo começa com ele (EF BB BF).
    const raw = new Uint8Array(await (await app.request(`/api/v1/tournaments/${t.id}/registrations.csv`, { headers: { Cookie: cookies.get('dono') ?? '' } })).arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = String(csv.data).trim().split('\r\n');
    expect(lines[0]?.split(';')[0]).toBe('Nome');
    expect(lines.slice(1).map((l) => l.split(';')[0])).toEqual(['Time Um', 'Time Dois', 'Time Três']);
    expect(lines[1]).toContain('um@exemplo.com');
    expect((await call('a', `/tournaments/${t.id}/registrations.csv`)).status).toBe(403);
  });
});
