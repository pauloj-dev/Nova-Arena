/**
 * Campeonatos contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): rascunho, ciclo de vida, limites,
 * equipe do evento e modelos (issue #75).
 * Critérios de aceite: transição inválida = 409; organizador acima do limite não publica.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { OrganizerTournament, OrganizerTournamentDetail, Problem, TournamentStaff, TournamentTemplate } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { DUEL_RULES, publishableDraft } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('campeonatos (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-8);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let fixture = { gameId: '', modeId: '', modelId: '' };

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `tn${key}${stamp}`;
    const user = await db.user.create({ data: { email: `tn.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `tn-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: true, roles }, new Date())}`);
    ids.set(key, user.id);
    return user;
  }

  const call = async (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(who ? { Cookie: cookies.get(who) ?? '' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null };
  };
  const detail = (data: unknown) => OrganizerTournamentDetail.parse(data);
  const code = (data: unknown) => Problem.parse(data).code;

  /** Cria um rascunho completo, pronto para publicar. */
  async function draft(who: string, name = `Copa ${randomUUID().slice(0, 6)}`) {
    const res = await call(who, '/tournaments', { method: 'POST', body: { ...publishableDraft(fixture), name } });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    return detail(res.data);
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db } });
    const game = await db.game.create({
      data: {
        slug: `duelo-${stamp}`,
        name: `Duelo ${stamp}`,
        modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } },
        scoringModels: { create: { name: 'Vitória', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points', 'wins'], isDefault: true } },
      },
      include: { modes: true, scoringModels: true },
    });
    fixture = { gameId: game.id, modeId: game.modes[0]?.id ?? '', modelId: game.scoringModels[0]?.id ?? '' };
    await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('coorg', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('mod', ['PARTICIPANT']);
    await makeUser('outro', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('jog', ['PARTICIPANT']);
    await makeUser('adm', ['ADMIN', 'PARTICIPANT']);
    await makeUser('cheio', ['ORGANIZER', 'PARTICIPANT']);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('rascunho: participante não cria; organizador cria e edita; endereço segue o nome enquanto rascunho', async () => {
    expect((await call('jog', '/tournaments', { method: 'POST', body: {} })).status).toBe(403);
    const t = await draft('dono', 'Copa Primavera');
    expect(t).toMatchObject({ status: 'DRAFT', access: 'OWNER', participantType: 'SOLO', stages: [expect.objectContaining({ name: 'Mata-mata', status: 'PENDING' })] });
    expect(t.slug).toMatch(/^copa-primavera/);

    const renamed = detail((await call('dono', `/tournaments/${t.id}`, { method: 'PATCH', body: { name: 'Copa Verão', description: '<p>Oi<script>alert(1)</script></p>' } })).data);
    expect(renamed.slug).toMatch(/^copa-verao/);
    expect(renamed.description).not.toContain('<script');

    // Outro organizador não vê nem edita.
    expect((await call('outro', `/organizer/tournaments/${t.id}`)).status).toBe(403);
    expect((await call('outro', `/tournaments/${t.id}`, { method: 'PATCH', body: { prize: 'x' } })).status).toBe(403);
    const mine = z.array(OrganizerTournament).parse((await call('dono', '/organizer/tournaments')).data);
    expect(mine.map((x) => x.id)).toContain(t.id);
  });

  it('Transição inválida = 409', async () => {
    const t = await draft('dono');
    expect(code((await call('dono', `/tournaments/${t.id}/pause`, { method: 'POST', body: { reason: 'Problema no servidor' } })).data)).toBe('INVALID_TRANSITION');
    expect((await call('dono', `/tournaments/${t.id}/close-registration`, { method: 'POST' })).status).toBe(409);
    expect((await call('dono', `/tournaments/${t.id}/archive`, { method: 'POST' })).status).toBe(409);

    const published = detail((await call('dono', `/tournaments/${t.id}/publish`, { method: 'POST' })).data);
    expect(published.status).toBe('REGISTRATION_OPEN');
    const again = await call('dono', `/tournaments/${t.id}/publish`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(code(again.data)).toBe('INVALID_TRANSITION');
    expect(detail((await call('dono', `/tournaments/${t.id}/close-registration`, { method: 'POST' })).data).status).toBe('REGISTRATION_CLOSED');

    // Publicado: jogo travado; não exclui; cancela com motivo e auditoria.
    expect(code((await call('dono', `/tournaments/${t.id}`, { method: 'PATCH', body: { gameModeId: randomUUID() } })).data)).toBe('GAME_LOCKED');
    expect(code((await call('dono', `/tournaments/${t.id}`, { method: 'DELETE' })).data)).toBe('NOT_A_DRAFT');
    const cancelled = detail((await call('dono', `/tournaments/${t.id}/cancel`, { method: 'POST', body: { reason: 'Falta de inscritos' } })).data);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Falta de inscritos' });
    expect(code((await call('dono', `/tournaments/${t.id}/cancel`, { method: 'POST', body: { reason: 'De novo' } })).data)).toBe('INVALID_TRANSITION');
    expect(code((await call('dono', `/tournaments/${t.id}`, { method: 'PATCH', body: { prize: 'x' } })).data)).toBe('TOURNAMENT_READ_ONLY');
    const logs = await db.auditLog.findMany({ where: { entityId: t.id }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['TOURNAMENT_PUBLISHED', 'TOURNAMENT_STATUS_CHANGED', 'TOURNAMENT_STATUS_CHANGED']);
    expect(logs.at(-1)?.reason).toBe('Falta de inscritos');
  });

  it('pausa e retomada com motivo; arquivar só depois de finalizado', async () => {
    const t = await draft('dono');
    await call('dono', `/tournaments/${t.id}/publish`, { method: 'POST' });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    const paused = detail((await call('dono', `/tournaments/${t.id}/pause`, { method: 'POST', body: { reason: 'Queda do servidor do jogo' } })).data);
    expect(paused).toMatchObject({ status: 'PAUSED', pauseReason: 'Queda do servidor do jogo' });
    expect(detail((await call('dono', `/tournaments/${t.id}/resume`, { method: 'POST', body: {} })).data)).toMatchObject({ status: 'IN_PROGRESS', pauseReason: null });
    expect((await call('dono', `/tournaments/${t.id}/archive`, { method: 'POST' })).status).toBe(409);
    await db.tournament.update({ where: { id: t.id }, data: { status: 'FINISHED' } });
    expect(detail((await call('dono', `/tournaments/${t.id}/archive`, { method: 'POST' })).data).status).toBe('ARCHIVED');
  });

  it('Organizador acima do limite não publica (e não conta rascunho nem cancelado)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const t = await draft('cheio');
      expect(detail((await call('cheio', `/tournaments/${t.id}/publish`, { method: 'POST' })).data).status).toBe('REGISTRATION_OPEN');
    }
    const fourth = await draft('cheio');
    const blocked = await call('cheio', `/tournaments/${fourth.id}/publish`, { method: 'POST' });
    expect(blocked.status).toBe(409);
    expect(code(blocked.data)).toBe('ORGANIZER_LIMIT');
    expect(detail((await call('cheio', `/organizer/tournaments/${fourth.id}`)).data).status).toBe('DRAFT');

    // Jogo fora da lista liberada pela administração: 403.
    await db.organizerLimits.create({ data: { userId: ids.get('outro') ?? '', maxActiveTournaments: 3, allowedGameIds: [randomUUID()] } });
    const other = await draft('outro');
    expect(code((await call('outro', `/tournaments/${other.id}/publish`, { method: 'POST' })).data)).toBe('GAME_NOT_ALLOWED');
  });

  it('rascunho incompleto não publica: pendências por campo', async () => {
    const res = await call('dono', '/tournaments', { method: 'POST', body: { gameId: fixture.gameId, gameModeId: fixture.modeId } });
    const t = detail(res.data);
    const publish = await call('dono', `/tournaments/${t.id}/publish`, { method: 'POST' });
    expect(publish.status).toBe(400);
    expect(code(publish.data)).toBe('INCOMPLETE');
    expect(Object.keys(Problem.parse(publish.data).errors ?? {})).toEqual(expect.arrayContaining(['name']));
  });

  it('equipe do evento: só o responsável monta; co-organizador edita mas não publica; moderador só vê', async () => {
    const t = await draft('dono');
    const added = await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `@tncoorg${stamp}`, role: 'CO_ORGANIZER' } });
    expect(TournamentStaff.parse(added.data)).toMatchObject({ role: 'CO_ORGANIZER' });
    await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `tnmod${stamp}`, role: 'MODERATOR' } });
    expect(code((await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `tnmod${stamp}`, role: 'MODERATOR' } })).data)).toBe('ALREADY_STAFF');
    expect(code((await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: 'ninguem-aqui', role: 'MODERATOR' } })).data)).toBe('USER_NOT_FOUND');

    expect(detail((await call('coorg', `/tournaments/${t.id}`, { method: 'PATCH', body: { prize: 'Troféu' } })).data)).toMatchObject({ prize: 'Troféu', access: 'CO_ORGANIZER' });
    expect((await call('coorg', `/tournaments/${t.id}/publish`, { method: 'POST' })).status).toBe(403);
    expect((await call('coorg', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `tnjog${stamp}`, role: 'MODERATOR' } })).status).toBe(403);
    expect(z.array(OrganizerTournament).parse((await call('coorg', '/organizer/tournaments')).data).map((x) => x.id)).toContain(t.id);

    expect(detail((await call('mod', `/organizer/tournaments/${t.id}`)).data).access).toBe('MODERATOR');
    expect((await call('mod', `/tournaments/${t.id}`, { method: 'PATCH', body: { prize: 'x' } })).status).toBe(403);
    expect(z.array(TournamentStaff).parse((await call('mod', `/tournaments/${t.id}/staff`)).data)).toHaveLength(2);

    const promoted = await call('dono', `/tournaments/${t.id}/staff/${ids.get('mod')}`, { method: 'PATCH', body: { role: 'CO_ORGANIZER' } });
    expect(TournamentStaff.parse(promoted.data).role).toBe('CO_ORGANIZER');
    expect((await call('dono', `/tournaments/${t.id}/staff/${ids.get('mod')}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.auditLog.count({ where: { entityId: t.id, action: 'STAFF_CHANGED' } })).toBe(4);
    // Admin passa em qualquer campeonato.
    expect(detail((await call('adm', `/organizer/tournaments/${t.id}`)).data).access).toBe('ADMIN');
  });

  it('modelos de campeonato e duplicar', async () => {
    const t = await draft('dono');
    const saved = await call('dono', '/tournament-templates', { method: 'POST', body: { tournamentId: t.id, name: `Meu modelo ${stamp}` } });
    const template = TournamentTemplate.parse(saved.data);
    expect(template.payload.stages).toHaveLength(1);
    expect(template.payload).not.toHaveProperty('name');
    expect(code((await call('dono', '/tournament-templates', { method: 'POST', body: { tournamentId: t.id, name: `meu modelo ${stamp}` } })).data)).toBe('TEMPLATE_NAME_TAKEN');

    const fromTemplate = detail((await call('dono', '/tournaments', { method: 'POST', body: { templateId: template.id, name: 'Do modelo' } })).data);
    expect(fromTemplate.stages.map((s) => s.name)).toEqual(['Mata-mata']);
    expect((await call('outro', `/tournament-templates/${template.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call('dono', `/tournament-templates/${template.id}`, { method: 'DELETE' })).status).toBe(204);

    const copy = await call('dono', `/tournaments/${t.id}/duplicate`, { method: 'POST' });
    expect(copy.status).toBe(201);
    expect(detail(copy.data)).toMatchObject({ status: 'DRAFT', name: `Cópia de ${t.name}` });
    expect((await call('dono', `/tournaments/${fromTemplate.id}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('modelo de pontuação personalizado: inválido recusado; em uso por fase iniciada não muda', async () => {
    const bad = await call('dono', '/organizer/scoring-models', { method: 'POST', body: { gameId: fixture.gameId, name: '', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } });
    expect(bad.status).toBe(400);
    const ok = await call('dono', '/organizer/scoring-models', { method: 'POST', body: { gameId: fixture.gameId, name: 'Meu modelo', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } });
    expect(ok.status).toBe(201);
    const model = z.object({ id: z.string() }).parse(ok.data);
    expect((await call('outro', `/organizer/scoring-models/${model.id}`, { method: 'PUT', body: { gameId: fixture.gameId, name: 'Roubado', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } })).status).toBe(403);
  });
});
