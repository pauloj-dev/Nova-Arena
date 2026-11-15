/**
 * Perfil contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): edição, IDs de jogo, perfil público,
 * visibilidade dos IDs de jogo e pedido de organizador (issue #72).
 * Critério de aceite: perfil público não devolve e-mail nem IDs de jogo.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { GameAccount, Me, OrganizerRequest, Problem } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost';
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('perfil (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-8);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let gameSlug = '';
  let gameId = '';

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[] = ['PARTICIPANT']) {
    const nickname = `${key}${stamp}`;
    const user = await db.user.create({ data: { email: `${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `perfil-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles }, new Date())}`);
    ids.set(key, user.id);
    return user;
  }

  const call = async (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(who ? { Cookie: cookies.get(who) ?? '' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null };
  };

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db } });
    gameSlug = `perfil-${stamp}`;
    const game = await db.game.create({
      data: {
        slug: gameSlug,
        name: 'Jogo Perfil',
        requiredAccountFields: [{ key: 'playerId', label: 'ID do jogador', pattern: '^[0-9]{6,12}$' }, { key: 'nick', label: 'Nick no jogo' }],
        modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } },
      },
      include: { modes: true },
    });
    gameId = game.id;
    await makeUser('bia');
    await makeUser('outro');
    await makeUser('estranho');
    const owner = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('adm', ['ADMIN', 'PARTICIPANT']);

    // Campeonato do "dono" com Bia e "outro" se enfrentando numa partida.
    const t = await db.tournament.create({ data: { slug: `copa-perfil-${stamp}`, name: 'Copa Perfil', gameId, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, participantType: 'SOLO', maxParticipants: 8 } });
    const regBia = await db.registration.create({ data: { tournamentId: t.id, userId: ids.get('bia'), status: 'CONFIRMED' } });
    const regOutro = await db.registration.create({ data: { tournamentId: t.id, userId: ids.get('outro'), status: 'CONFIRMED' } });
    const model = await db.scoringModel.create({ data: { gameId, name: 'Vitória', matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], tiebreakers: ['points'] } });
    const stage = await db.stage.create({ data: { tournamentId: t.id, name: 'Chave', order: 1, format: 'SINGLE_ELIM', scoringModelId: model.id } });
    await db.match.create({ data: { stageId: stage.id, nodeId: 'w-r1-m1', round: 1, position: 1, participants: { create: [{ registrationId: regBia.id, slot: 1 }, { registrationId: regOutro.id, slot: 2 }] } } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('edita o perfil; apelido único sem diferenciar maiúsculas e filtrado', async () => {
    const ok = await call('bia', '/me', { method: 'PATCH', body: { bio: '  Sinuca e futebol.  ', socials: { discord: 'bia#1', instagram: '  ' }, timezone: 'America/Sao_Paulo' } });
    expect(Me.parse(ok.data)).toMatchObject({ bio: 'Sinuca e futebol.', socials: { discord: 'bia#1' }, timezone: 'America/Sao_Paulo' });

    const taken = await call('bia', '/me', { method: 'PATCH', body: { nickname: `OUTRO${stamp}` } });
    expect(taken.status).toBe(409);
    expect(Problem.parse(taken.data).code).toBe('NICKNAME_TAKEN');

    const blocked = await call('bia', '/me', { method: 'PATCH', body: { nickname: 'Admin_Oficial' } });
    expect(blocked.status).toBe(400);
    expect(Problem.parse(blocked.data).errors?.nickname).toMatch(/reservado/);

    // Trocar só maiúsculas do próprio apelido é permitido.
    const recase = await call('bia', '/me', { method: 'PATCH', body: { nickname: `BIA${stamp}` } });
    expect(Me.parse(recase.data).nickname).toBe(`BIA${stamp}`);

    expect((await call('bia', '/me', { method: 'PATCH', body: { timezone: 'Lua/Base' } })).status).toBe(400);
  });

  it('IDs de jogo: só os campos do jogo, no formato dele', async () => {
    const bad = await call('bia', `/me/game-accounts/${gameSlug}`, { method: 'PUT', body: { fields: { playerId: 'abc', nick: 'Bia' } } });
    expect(Problem.parse(bad.data).errors?.['fields.playerId']).toMatch(/formato/);
    const ok = await call('bia', `/me/game-accounts/${gameSlug}`, { method: 'PUT', body: { fields: { playerId: '1234567', nick: 'Bia', extra: 'ignorado' } } });
    expect(Me.parse(ok.data).gameAccounts).toEqual([expect.objectContaining({ gameId, fields: { playerId: '1234567', nick: 'Bia' } })]);
    // De novo: atualiza, não duplica.
    await call('bia', `/me/game-accounts/${gameId}`, { method: 'PUT', body: { fields: { playerId: '7654321', nick: 'Bia' } } });
    expect(await db.gameAccount.count({ where: { userId: ids.get('bia') } })).toBe(1);
  });

  it('Perfil público não devolve e-mail nem IDs de jogo (nem para visitante)', async () => {
    const res = await call(null, `/users/bia${stamp}`);
    expect(res.status).toBe(200);
    const body = res.data as Record<string, unknown>;
    expect(body.nickname).toBe(`BIA${stamp}`);
    for (const secret of ['email', 'gameAccounts', 'birthDate', 'emailVerified', 'status', 'timezone']) expect(body).not.toHaveProperty(secret);
    expect(JSON.stringify(body)).not.toContain('1234567');
    expect(JSON.stringify(body)).not.toContain('@exemplo.com');
    expect((await call(null, '/users/ninguem-aqui')).status).toBe(404);
  });

  it('IDs de jogo de outra pessoa: organização e adversário veem; estranho não; visitante precisa entrar', async () => {
    const path = `/users/bia${stamp}/game-accounts`;
    expect((await call(null, path)).status).toBe(401);
    const stranger = await call('estranho', path);
    expect(stranger.status).toBe(403);
    expect(Problem.parse(stranger.data).code).toBe('GAME_ACCOUNTS_HIDDEN');
    for (const who of ['dono', 'outro', 'adm', 'bia']) {
      const res = await call(who, path);
      expect(res.status, who).toBe(200);
      expect(z.array(GameAccount).parse(res.data)[0]?.fields.playerId).toBe('7654321');
    }
  });

  it('pedido de organizador: entra na fila uma vez; organizador não pede', async () => {
    expect((await call('bia', '/me/organizer-request')).data).toBeNull();
    const justification = 'Organizo campeonatos de sinuca no meu bairro há dois anos.';
    const created = await call('bia', '/me/organizer-request', { method: 'POST', body: { justification } });
    expect(created.status).toBe(201);
    expect(OrganizerRequest.parse(created.data)).toMatchObject({ status: 'PENDING', justification });
    expect(Problem.parse((await call('bia', '/me/organizer-request', { method: 'POST', body: { justification } })).data).code).toBe('REQUEST_PENDING');
    expect(Problem.parse((await call('dono', '/me/organizer-request', { method: 'POST', body: { justification } })).data).code).toBe('ALREADY_ORGANIZER');
    expect(OrganizerRequest.parse((await call('bia', '/me/organizer-request')).data).status).toBe('PENDING');
  });
});
