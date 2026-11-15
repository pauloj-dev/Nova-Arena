/**
 * Leitura pública, jobs de inscrição e comunicados contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI).
 * Critérios de aceite (issue #76): job de abrir inscrições executado 2 vezes não muda nada na 2ª; lista com
 * 20 itens em menos de 1,5 s.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Announcement, page, Problem, Tournament, TournamentSummary } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { runRegistrationJob, syncRegistrationWindows } from '../src/jobs/registration';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });
const Page = page(TournamentSummary);

describe.skipIf(!url)('listagem, jobs e comunicados (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-8);
  const cookies = new Map<string, string>();
  let gameSlug = '';
  let gameId = '';
  let modeId = '';
  let modelId = '';
  let ownerId = '';

  async function makeUser(key: string, roles: ('ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `ls${key}${stamp}`;
    const user = await db.user.create({ data: { email: `ls.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `ls-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles }, new Date())}`);
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

  async function tournament(name: string, status: 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED' | 'ARCHIVED', extra: Record<string, unknown> = {}) {
    const t = await db.tournament.create({
      data: { slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${stamp}-${randomUUID().slice(0, 4)}`, name, gameId, gameModeId: modeId, ownerId, status, participantType: 'SOLO', maxParticipants: 8, ...extra },
    });
    await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: modelId } });
    return t;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db } });
    gameSlug = `lista-${stamp}`;
    const game = await db.game.create({
      data: { slug: gameSlug, name: `Lista ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'Vitória', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    gameId = game.id;
    modeId = game.modes[0]?.id ?? '';
    modelId = game.scoringModels[0]?.id ?? '';
    ownerId = (await makeUser('dono', ['ORGANIZER', 'PARTICIPANT'])).id;
    await makeUser('jog', ['PARTICIPANT']);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('lista pública: sem rascunho, arquivado nem cancelado; ordem da vitrine; filtros', async () => {
    await tournament('Rascunho Secreto', 'DRAFT');
    await tournament('Arquivado Velho', 'ARCHIVED');
    await tournament('Cancelado Triste', 'CANCELLED');
    const finished = await tournament('Copa Final', 'FINISHED');
    const open = await tournament('Copa Aberta', 'REGISTRATION_OPEN');
    const live = await tournament('Copa Ao Vivo', 'IN_PROGRESS');

    const list = Page.parse((await call(null, `/tournaments?game=${gameSlug}`)).data);
    expect(list.items.map((t) => t.id)).toEqual([open.id, live.id, finished.id]);
    expect(Page.parse((await call(null, `/tournaments?game=${gameSlug}&status=live`)).data).items.map((t) => t.id)).toEqual([live.id]);
    expect(Page.parse((await call(null, `/tournaments?game=${gameSlug}&q=aberta`)).data).items.map((t) => t.id)).toEqual([open.id]);
    expect(Page.parse((await call(null, `/tournaments?game=${gameSlug}&slots=available`)).data).items.map((t) => t.id)).toEqual([open.id]);
    expect((await call(null, '/tournaments?limit=999')).status).toBe(400);
  });

  it('paginação por cursor e lista de 20 itens em menos de 1,5 s', async () => {
    for (let i = 0; i < 22; i += 1) await tournament(`Página ${i}`, 'REGISTRATION_OPEN', { startsAt: new Date(Date.now() + (i + 1) * 3600_000) });
    const started = performance.now();
    const first = await call(null, `/tournaments?game=${gameSlug}&status=open&limit=20`);
    const elapsed = performance.now() - started;
    const p1 = Page.parse(first.data);
    expect(p1.items).toHaveLength(20);
    expect(elapsed).toBeLessThan(1500);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = Page.parse((await call(null, `/tournaments?game=${gameSlug}&status=open&limit=20&cursor=${p1.nextCursor}`)).data);
    expect(p2.items.length).toBeGreaterThan(0);
    expect(new Set([...p1.items, ...p2.items].map((t) => t.id)).size).toBe(p1.items.length + p2.items.length);
    expect((await call(null, '/tournaments?cursor=lixo')).status).toBe(400);
  });

  it('detalhe: público para publicado; rascunho só para a organização', async () => {
    const draft = await tournament('Rascunho Dois', 'DRAFT');
    expect((await call(null, `/tournaments/${draft.slug}`)).status).toBe(404);
    expect((await call('jog', `/tournaments/${draft.slug}`)).status).toBe(404);
    expect(Tournament.parse((await call('dono', `/tournaments/${draft.slug}`)).data).id).toBe(draft.id);
    const pub = await tournament('Publicado Um', 'PUBLISHED');
    const view = (await call(null, `/tournaments/${pub.slug}`)).data as Record<string, unknown>;
    expect(Tournament.parse(view).organizer.nickname).toBe(`lsdono${stamp}`);
    expect(JSON.stringify(view)).not.toContain('@exemplo.com');
    expect((await call('dono', `/tournaments/${pub.id}/access`)).data).toEqual({ access: 'OWNER' });
    expect((await call('jog', `/tournaments/${pub.id}/access`)).data).toEqual({ access: null });
  });

  it('Job de abrir inscrições executado 2 vezes não muda nada na 2ª', async () => {
    const t = await tournament('Abre Sozinho', 'PUBLISHED', { registrationOpensAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86_400_000) });
    const now = new Date();
    expect(await runRegistrationJob(db, t.id, 'open', now)).toBe(true);
    const after1 = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(await runRegistrationJob(db, t.id, 'open', now)).toBe(false);
    const after2 = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(after1.status).toBe('REGISTRATION_OPEN');
    expect(after2).toEqual(after1);
    expect(await db.auditLog.count({ where: { entityId: t.id, action: 'TOURNAMENT_STATUS_CHANGED', actorId: null } })).toBe(1);
    // Antes da hora não abre; fechar só depois do prazo.
    const later = await tournament('Abre Depois', 'PUBLISHED', { registrationOpensAt: new Date(Date.now() + 3_600_000) });
    expect(await runRegistrationJob(db, later.id, 'open', now)).toBe(false);
    expect(await runRegistrationJob(db, t.id, 'close', now)).toBe(false);
  });

  it('Cron corrige o que ficou para trás (abre e fecha na mesma passada)', async () => {
    const t = await tournament('Atrasado', 'PUBLISHED', { registrationOpensAt: new Date(Date.now() - 7_200_000), registrationClosesAt: new Date(Date.now() - 3_600_000) });
    const result = await syncRegistrationWindows(db, new Date());
    expect(result.opened).toBeGreaterThanOrEqual(1);
    expect(result.closed).toBeGreaterThanOrEqual(1);
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('REGISTRATION_CLOSED');
    // Segunda passada: nada pendente para este campeonato.
    await syncRegistrationWindows(db, new Date());
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('REGISTRATION_CLOSED');
  });

  it('comunicados: organização envia (todos ou fase) e apaga; participante não; rascunho não recebe', async () => {
    const draft = await tournament('Rascunho Três', 'DRAFT');
    expect(Problem.parse((await call('dono', `/tournaments/${draft.id}/announcements`, { method: 'POST', body: { title: 'Oi', body: 'Mensagem' } })).data).code).toBe('TOURNAMENT_NOT_PUBLISHED');

    const t = await tournament('Com Avisos', 'REGISTRATION_OPEN');
    const stage = await db.stage.findFirstOrThrow({ where: { tournamentId: t.id } });
    expect((await call('jog', `/tournaments/${t.id}/announcements`, { method: 'POST', body: { title: 'Oi', body: 'Mensagem' } })).status).toBe(403);
    const all = await call('dono', `/tournaments/${t.id}/announcements`, { method: 'POST', body: { title: 'Bem-vindos', body: 'Check-in 30 min antes.' } });
    expect(Announcement.parse(all.data)).toMatchObject({ authorNickname: `lsdono${stamp}`, stageId: null });
    const toStage = await call('dono', `/tournaments/${t.id}/announcements`, { method: 'POST', body: { title: 'Fase', body: 'Começa amanhã.', stageId: stage.id } });
    expect(Announcement.parse(toStage.data).stageId).toBe(stage.id);
    expect((await call('dono', `/tournaments/${t.id}/announcements`, { method: 'POST', body: { title: 'Grupo', body: 'x', groupId: randomUUID() } })).status).toBe(400);
    expect((await call('dono', `/tournaments/${t.id}/announcements`, { method: 'POST', body: { title: 'Fase', body: 'x', stageId: randomUUID() } })).status).toBe(400);

    const list = z.array(Announcement).parse((await call(null, `/tournaments/${t.id}/announcements`)).data);
    expect(list.map((a) => a.title)).toEqual(['Fase', 'Bem-vindos']);
    const first = Announcement.parse(all.data);
    expect((await call('jog', `/announcements/${first.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call('dono', `/announcements/${first.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.auditLog.count({ where: { tournamentId: t.id, action: { in: ['ANNOUNCEMENT_SENT', 'ANNOUNCEMENT_DELETED'] } } })).toBe(3);
  });
});
