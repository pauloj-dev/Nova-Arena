/**
 * Inscrito avulso e elenco sem conta (RN-18) contra um Postgres de verdade (`TEST_DATABASE_URL`). Os mesmos
 * cenários da API simulada (`apps/web/mocks/handlers/registrations-guests.test.ts`):
 * - a organização cadastra um jogador ou squad sem conta, sem planilha (confirmado; sem vaga, lista de espera);
 * - monta, corrige e desfaz o elenco de um squad sem conta, no modo do campeonato (4 titulares + 1 reserva);
 * - a planilha traz o elenco; o mesmo ID no jogo não entra em dois squads; o público não vê os IDs.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { ImportRegistrationsResult, Problem, Registration, RosterChangeResult } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('inscrito avulso e elenco sem conta (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-7);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const id = (k: string) => ids.get(k) ?? '';
  let soloGame = { id: '', modeId: '', modelId: '' };
  let squadGame = { id: '', modeId: '', modelId: '' };

  async function makeUsers(keys: string[]) {
    await db.user.createMany({ data: keys.map((k) => ({ email: `gs.${k}.${stamp}@exemplo.com`, nickname: `gs${k}${stamp}`.slice(0, 20), nicknameKey: `gs${k}${stamp}`.slice(0, 20).toLowerCase() })) });
    const users = await db.user.findMany({ where: { email: { in: keys.map((k) => `gs.${k}.${stamp}@exemplo.com`) } } });
    await db.userRole.createMany({ data: users.map((u) => ({ userId: u.id, role: 'PARTICIPANT' as const })) });
    for (const u of users) {
      const key = u.email.split('.')[1] ?? '';
      const session = await db.session.create({ data: { userId: u.id, familyId: randomUUID(), refreshTokenHash: `gs-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
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
    return { status: res.status, data };
  };
  const problem = (data: unknown) => Problem.parse(data);
  const addManual = (who: string | null, tournamentId: string, body: unknown) => call(who, `/tournaments/${tournamentId}/registrations/manual`, { method: 'POST', body });
  const addGuest = (who: string, registrationId: string, body: unknown) => call(who, `/registrations/${registrationId}/guests`, { method: 'POST', body });
  const list = async (who: string | null, tournamentId: string, scope = '?scope=all') => z.array(Registration).parse((await call(who, `/tournaments/${tournamentId}/registrations${scope}`)).data);
  const squad = (prefix: string, count: number, firstId = 1000) => Array.from({ length: count }, (_, i) => ({ name: `${prefix}${i + 1}`, gameId: String(firstId + i) }));

  async function tournament(game: { id: string; modeId: string; modelId: string }, opts: { type: 'SOLO' | 'TEAM'; max?: number; manualApproval?: boolean; waitlistEnabled?: boolean }) {
    const slug = `copa-gs-${stamp}-${randomUUID().slice(0, 6)}`;
    const t = await db.tournament.create({
      data: { slug, name: 'Copa Manual', gameId: game.id, gameModeId: game.modeId, ownerId: id('dono'), status: 'REGISTRATION_OPEN', participantType: opts.type, maxParticipants: opts.max ?? 8, manualApproval: opts.manualApproval ?? false, waitlistEnabled: opts.waitlistEnabled ?? true },
    });
    await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Chave', format: 'SINGLE_ELIM', scoringModelId: game.modelId, tiebreakers: ['points'] } });
    return t;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 10 });
    app = createApp({ env, deps: { db: () => db } });
    const solo = await db.game.create({
      data: { slug: `gs-solo-${stamp}`, name: `Solo ${stamp}`, requiredAccountFields: [{ key: 'playerId', label: 'ID' }], modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    soloGame = { id: solo.id, modeId: solo.modes[0]?.id ?? '', modelId: solo.scoringModels[0]?.id ?? '' };
    // Como o Contra Squad 4v4 do Free Fire: 4 titulares + 1 reserva, com ID do jogo obrigatório para quem tem conta.
    const ff = await db.game.create({
      data: {
        slug: `gs-squad-${stamp}`,
        name: `Squad ${stamp}`,
        requiredAccountFields: [{ key: 'playerId', label: 'ID' }],
        modes: { create: { name: '4v4', teamSize: 4, maxSubs: 1, matchType: 'TEAM_VS_TEAM' } },
        scoringModels: { create: { name: 'V', matchType: 'TEAM_VS_TEAM', rules: DUEL_RULES, tiebreakers: ['points'] } },
      },
      include: { modes: true, scoringModels: true },
    });
    squadGame = { id: ff.id, modeId: ff.modes[0]?.id ?? '', modelId: ff.scoringModels[0]?.id ?? '' };
    await makeUsers(['dono', 'mod', 'fora', 'cap']);
    await db.userRole.create({ data: { userId: id('dono'), role: 'ORGANIZER' } });
  }, 60_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  it('jogador avulso: entra confirmado sem conta, sem aprovação manual nem ID do jogo; fica na auditoria e na exportação', async () => {
    const t = await tournament(soloGame, { type: 'SOLO', manualApproval: true });
    const res = await addManual('dono', t.id, { name: '  Zeca Avulso ', contact: 'zeca@exemplo.com', gameId: '123456' });
    expect(res.status).toBe(201);
    const registration = Registration.parse(res.data);
    expect(registration).toMatchObject({ displayName: 'Zeca Avulso', status: 'CONFIRMED', userId: null, teamId: null, guests: [] });
    expect(await db.auditLog.count({ where: { entityId: registration.id, action: 'REGISTRATION_ADDED', actorId: id('dono') } })).toBe(1);
    const csv = String((await call('dono', `/tournaments/${t.id}/registrations.csv`)).data);
    expect(csv).toContain('Zeca Avulso;;Importada;Confirmada;;;;;');
    expect(csv).toContain('zeca@exemplo.com;123456');

    expect(problem((await addManual('dono', t.id, { name: 'zeca avulso' })).data)).toMatchObject({ status: 409, code: 'NAME_TAKEN', errors: { name: 'Já existe um inscrito chamado "zeca avulso" neste campeonato.' } });
    expect(problem((await addManual('dono', t.id, { name: 'Com Elenco', members: [{ name: 'A' }] })).data)).toMatchObject({ status: 400, code: 'INVALID_ROSTER' });
    expect((await addManual('dono', t.id, { name: '' })).status).toBe(400);
  });

  it('só a organização cadastra: moderador, jogador de fora e visitante são recusados', async () => {
    const t = await tournament(soloGame, { type: 'SOLO' });
    await db.tournamentStaff.create({ data: { tournamentId: t.id, userId: id('mod'), role: 'MODERATOR', addedById: id('dono') } });
    expect((await addManual('mod', t.id, { name: 'X' })).status).toBe(403);
    expect((await addManual('fora', t.id, { name: 'X' })).status).toBe(403);
    expect((await addManual(null, t.id, { name: 'X' })).status).toBe(401);
    expect(await db.registration.count({ where: { tournamentId: t.id } })).toBe(0);
  });

  it('sem vaga vai para a lista de espera; com a lista desligada é recusado; rascunho e campeonato iniciado não aceitam', async () => {
    const t = await tournament(soloGame, { type: 'SOLO', max: 1 });
    expect(Registration.parse((await addManual('dono', t.id, { name: 'Primeiro' })).data).status).toBe('CONFIRMED');
    expect(Registration.parse((await addManual('dono', t.id, { name: 'Segundo' })).data)).toMatchObject({ status: 'WAITLIST', waitlistPosition: 1 });
    await db.tournament.update({ where: { id: t.id }, data: { waitlistEnabled: false } });
    expect(problem((await addManual('dono', t.id, { name: 'Terceiro' })).data)).toMatchObject({ status: 409, code: 'TOURNAMENT_FULL' });
    for (const status of ['DRAFT', 'IN_PROGRESS'] as const) {
      await db.tournament.update({ where: { id: t.id }, data: { status } });
      expect(problem((await addManual('dono', t.id, { name: `Fora de hora ${status}` })).data)).toMatchObject({ status: 409, code: 'REGISTRATIONS_LOCKED' });
    }
  });

  it('squad avulso com o elenco do modo (4 titulares + 1 reserva); o público vê os nomes, não os IDs', async () => {
    const t = await tournament(squadGame, { type: 'TEAM', manualApproval: true });
    const res = await addManual('dono', t.id, { name: 'Squad Manual', tag: 'man', members: [{ name: 'Banco', gameId: '2000', isSub: true }, ...squad('Titular', 4)] });
    expect(res.status).toBe(201);
    const registration = Registration.parse(res.data);
    expect(registration).toMatchObject({ displayName: 'Squad Manual', tag: 'MAN', status: 'CONFIRMED', requiredMembers: 4, members: [] });
    // Titulares primeiro, na ordem em que vieram.
    expect(registration.guests.map((g) => [g.name, g.gameId, g.isSub])).toEqual([['Titular1', '1000', false], ['Titular2', '1001', false], ['Titular3', '1002', false], ['Titular4', '1003', false], ['Banco', '2000', true]]);

    for (const [who, scope] of [[null, ''], ['fora', '?scope=all']] as const) {
      const visible = (await list(who, t.id, scope)).find((r) => r.id === registration.id);
      expect(visible?.guests.map((g) => g.name)).toEqual(['Titular1', 'Titular2', 'Titular3', 'Titular4', 'Banco']);
      expect(visible?.guests.every((g) => g.gameId === null)).toBe(true);
    }
    expect((await list('dono', t.id)).find((r) => r.id === registration.id)?.guests[0]?.gameId).toBe('1000');
  });

  it('elenco fora do modo ou repetido é recusado com o motivo, e nada é gravado', async () => {
    const t = await tournament(squadGame, { type: 'TEAM' });
    const detail = async (body: unknown) => problem((await addManual('dono', t.id, body)).data).detail;
    expect(await detail({ name: 'Cinco Titulares', members: squad('T', 5) })).toBe('Este modo tem 4 titulares por squad: o elenco ficaria com 5.');
    expect(await detail({ name: 'Duas Reservas', members: [{ name: 'A', isSub: true }, { name: 'B', isSub: true }] })).toBe('Este modo aceita 1 reserva por squad: o elenco ficaria com 2.');
    expect(await detail({ name: 'Nome Repetido', members: [{ name: 'Ana' }, { name: ' ana ' }] })).toBe('O jogador "ana" aparece duas vezes no elenco.');
    expect(await detail({ name: 'ID Repetido', members: [{ name: 'Ana', gameId: '77' }, { name: 'Bia', gameId: '77' }] })).toBe('O ID no jogo "77" aparece duas vezes no elenco.');
    expect(await db.registration.count({ where: { tournamentId: t.id } })).toBe(0);
    expect(await db.registrationGuest.count({ where: { tournamentId: t.id } })).toBe(0);
  });

  it('a organização coloca, corrige e tira jogadores do squad sem conta, com auditoria', async () => {
    const t = await tournament(squadGame, { type: 'TEAM' });
    const reg = Registration.parse((await addManual('dono', t.id, { name: 'Squad Vazio' })).data);
    const guests = (data: unknown) => RosterChangeResult.parse(data).registrations[0]?.guests ?? [];

    const added = await addGuest('dono', reg.id, { name: ' Kaue ', gameId: ' 555 ' });
    expect(added.status).toBe(201);
    expect(guests(added.data)).toEqual([{ id: expect.any(String), name: 'Kaue', gameId: '555', isSub: false }]);
    for (const name of ['B', 'C', 'D']) expect((await addGuest('dono', reg.id, { name })).status).toBe(201);
    // Titulares completos: o quinto só entra como reserva; a segunda reserva não cabe; nome repetido também não.
    expect(problem((await addGuest('dono', reg.id, { name: 'E' })).data)).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect((await addGuest('dono', reg.id, { name: 'E', isSub: true })).status).toBe(201);
    expect(problem((await addGuest('dono', reg.id, { name: 'F', isSub: true })).data)).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect((await addGuest('dono', reg.id, { name: 'kaue', isSub: true })).status).toBe(409);
    expect((await addGuest('dono', reg.id, { name: '' })).status).toBe(400);

    const kaue = guests(added.data)[0]?.id ?? '';
    const fixed = await call('dono', `/registrations/${reg.id}/guests/${kaue}`, { method: 'PATCH', body: { name: 'Kauê', gameId: null } });
    expect(fixed.status).toBe(200);
    expect(guests(fixed.data).find((g) => g.id === kaue)).toEqual({ id: kaue, name: 'Kauê', gameId: null, isSub: false });
    // Virar reserva com a vaga de reserva ocupada não cabe; corpo vazio não muda nada.
    expect(problem((await call('dono', `/registrations/${reg.id}/guests/${kaue}`, { method: 'PATCH', body: { isSub: true } })).data)).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    expect((await call('dono', `/registrations/${reg.id}/guests/${kaue}`, { method: 'PATCH', body: {} })).status).toBe(400);

    const removed = await call('dono', `/registrations/${reg.id}/guests/${kaue}`, { method: 'DELETE' });
    expect(guests(removed.data).map((g) => g.name)).toEqual(['B', 'C', 'D', 'E']);
    expect((await call('dono', `/registrations/${reg.id}/guests/${kaue}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call('dono', `/registrations/${reg.id}/guests/nao-e-uuid`, { method: 'DELETE' })).status).toBe(404);

    const audit = await db.auditLog.findMany({ where: { entityId: reg.id, action: 'ROSTER_CHANGED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    // O JSONB não guarda a ordem das chaves: confere qual das três ações cada registro traz.
    expect(audit.map((l) => ['escalou', 'corrigiu', 'tirou'].find((key) => key in (l.after as object)))).toEqual(['escalou', 'escalou', 'escalou', 'escalou', 'escalou', 'corrigiu', 'tirou']);
    // A inscrição continua confirmada: o elenco sem conta não muda o status dela.
    expect((await db.registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe('CONFIRMED');
  });

  it('o mesmo ID no jogo não entra em dois squads do campeonato (mas volta a valer quando o squad sai)', async () => {
    const t = await tournament(squadGame, { type: 'TEAM' });
    const one = Registration.parse((await addManual('dono', t.id, { name: 'Squad Um', members: [{ name: 'Ana', gameId: 'ABC123' }] })).data);
    expect(problem((await addManual('dono', t.id, { name: 'Squad Dois', members: [{ name: 'Outra Ana', gameId: 'abc123' }] })).data).detail).toBe(
      'O ID no jogo "ABC123" já está no elenco do Squad Um neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.',
    );
    const two = Registration.parse((await addManual('dono', t.id, { name: 'Squad Dois' })).data);
    expect(problem((await addGuest('dono', two.id, { name: 'Outra Ana', gameId: 'ABC123' })).data)).toMatchObject({ status: 409, code: 'INVALID_ROSTER' });
    const bia = RosterChangeResult.parse((await addGuest('dono', two.id, { name: 'Bia', gameId: 'XYZ' })).data).registrations[0]?.guests[0]?.id ?? '';
    expect((await call('dono', `/registrations/${two.id}/guests/${bia}`, { method: 'PATCH', body: { gameId: 'abc123' } })).status).toBe(409);
    // Mesmo ID em outro campeonato não atrapalha.
    const other = await tournament(squadGame, { type: 'TEAM' });
    expect((await addManual('dono', other.id, { name: 'Squad Um', members: [{ name: 'Ana', gameId: 'ABC123' }] })).status).toBe(201);
    // O squad removido libera o ID.
    expect((await call('dono', `/registrations/${one.id}`, { method: 'PATCH', body: { action: 'remove', reason: 'Desistiu antes do início' } })).status).toBe(200);
    expect((await call('dono', `/registrations/${two.id}/guests/${bia}`, { method: 'PATCH', body: { gameId: 'abc123' } })).status).toBe(200);
  });

  it('só a organização mexe no elenco; squad com conta, inscrição individual e campeonato encerrado ficam de fora', async () => {
    const t = await tournament(squadGame, { type: 'TEAM' });
    await db.tournamentStaff.create({ data: { tournamentId: t.id, userId: id('mod'), role: 'MODERATOR', addedById: id('dono') } });
    const reg = Registration.parse((await addManual('dono', t.id, { name: 'Squad Fechado' })).data);
    expect((await addGuest('mod', reg.id, { name: 'X' })).status).toBe(403);
    expect((await addGuest('fora', reg.id, { name: 'X' })).status).toBe(403);
    expect((await addGuest('dono', randomUUID(), { name: 'X' })).status).toBe(404);

    const team = await db.team.create({ data: { name: `Squad Conta ${stamp}`, tag: `G${stamp.slice(-3)}`, captainId: id('cap'), members: { create: [{ userId: id('cap'), role: 'CAPTAIN' }] } } });
    const withAccount = await db.registration.create({ data: { tournamentId: t.id, teamId: team.id, status: 'PENDING_MEMBERS' } });
    expect(problem((await addGuest('dono', withAccount.id, { name: 'X' })).data)).toMatchObject({ status: 409, code: 'NOT_STAFF_REGISTRATION' });

    const soloT = await tournament(soloGame, { type: 'SOLO' });
    const solo = Registration.parse((await addManual('dono', soloT.id, { name: 'Jogador Solo' })).data);
    expect(problem((await addGuest('dono', solo.id, { name: 'X' })).data)).toMatchObject({ status: 409, code: 'SOLO_REGISTRATION' });

    // Com o campeonato em andamento a organização ainda troca o elenco; depois do fim, não.
    await db.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    expect((await addGuest('dono', reg.id, { name: 'Durante' })).status).toBe(201);
    await db.tournament.update({ where: { id: t.id }, data: { status: 'FINISHED' } });
    expect(problem((await addGuest('dono', reg.id, { name: 'Depois' })).data)).toMatchObject({ status: 409, code: 'ROSTER_CLOSED' });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    await db.registration.update({ where: { id: reg.id }, data: { status: 'WITHDRAWN' } });
    expect(problem((await addGuest('dono', reg.id, { name: 'Fora' })).data)).toMatchObject({ status: 409, code: 'REGISTRATION_INACTIVE' });
  });

  it('a planilha traz o elenco; linha com elenco fora do modo ou ID que já joga por outro squad é pulada', async () => {
    const t = await tournament(squadGame, { type: 'TEAM' });
    const result = ImportRegistrationsResult.parse(
      (
        await call('dono', `/tournaments/${t.id}/registrations/import`, {
          method: 'POST',
          body: {
            rows: [
              { name: 'Time A', tag: 'a', members: [...squad('A', 4, 100), { name: 'AR', isSub: true }] },
              { name: 'Time B', members: squad('B', 5, 200) },
              { name: 'Time C', members: [{ name: 'C1', gameId: '100' }] },
              { name: 'Time D' },
            ],
          },
        })
      ).data,
    );
    expect(result).toEqual({
      created: 2,
      waitlisted: 0,
      skipped: [
        { row: 2, reason: 'Este modo tem 4 titulares por squad: o elenco ficaria com 5.' },
        { row: 3, reason: 'O ID no jogo "100" já está no elenco do Time A neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.' },
      ],
    });
    const all = await list('dono', t.id);
    expect(all.find((r) => r.displayName === 'Time A')?.guests.map((g) => `${g.name}${g.isSub ? '*' : ''}`)).toEqual(['A1', 'A2', 'A3', 'A4', 'AR*']);
    expect(all.find((r) => r.displayName === 'Time D')?.guests).toEqual([]);
    expect(String((await call('dono', `/tournaments/${t.id}/registrations.csv`)).data)).toContain('Time A;A;Importada;Confirmada;;A1, A2, A3, A4, AR (reserva);');

    // Em campeonato individual, linha com elenco é pulada (a tela nem manda essas colunas).
    const soloT = await tournament(soloGame, { type: 'SOLO' });
    const solo = ImportRegistrationsResult.parse((await call('dono', `/tournaments/${soloT.id}/registrations/import`, { method: 'POST', body: { rows: [{ name: 'Zeca', members: [{ name: 'A' }] }, { name: 'Bia' }] } })).data);
    expect(solo).toEqual({ created: 1, waitlisted: 0, skipped: [{ row: 1, reason: 'Este campeonato é individual: o inscrito não tem elenco.' }] });
  });

  it('o squad sem conta entra na chave e na partida como qualquer inscrito', async () => {
    const t = await tournament(squadGame, { type: 'TEAM' });
    for (const name of ['Alfa', 'Beta']) expect((await addManual('dono', t.id, { name: `Squad ${name}`, members: squad(name, 4, name === 'Alfa' ? 10 : 20) })).status).toBe(201);
    await db.tournament.update({ where: { id: t.id }, data: { status: 'REGISTRATION_CLOSED' } });
    const stage = await db.stage.findFirstOrThrow({ where: { tournamentId: t.id } });
    expect((await call('dono', `/stages/${stage.id}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } })).status).toBe(200);
    expect((await call('dono', `/stages/${stage.id}/confirm`, { method: 'POST' })).status).toBe(200);
    const matches = await db.match.findMany({ where: { stageId: stage.id }, include: { participants: { include: { registration: { select: { displayName: true } } } } } });
    expect(matches[0]?.participants.map((p) => p.registration?.displayName).sort()).toEqual(['Squad Alfa', 'Squad Beta']);
    // O elenco continua editável com o campeonato em andamento.
    const alfa = (await list('dono', t.id)).find((r) => r.displayName === 'Squad Alfa');
    expect((await addGuest('dono', alfa?.id ?? '', { name: 'Reserva de última hora', isSub: true })).status).toBe(201);
  });
});
