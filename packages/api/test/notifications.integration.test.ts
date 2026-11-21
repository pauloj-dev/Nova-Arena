/**
 * Notificações, e-mail, push e token do tempo real contra um Postgres de verdade (`TEST_DATABASE_URL`) —
 * issues #98, #109 e #97.
 * Critérios: preferência desligada não envia e-mail; falha do Resend é tentada de novo sem duplicar; o token de um
 * participante não assina `match:{id}` de outra partida; visitante não recebe `user:*`.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { FollowList, Match, Notification, NotificationPreference, page, Problem, RealtimeTokenRequest, UnreadCount } from '@nova/schemas';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import type { ScheduledJob } from '../src/jobs';
import type { EmailMessage } from '../src/mail';
import { type PushSender } from '../src/modules/push/sender';
import { NOTIFICATION_EMAIL_JOB_PATH, NOTIFICATION_PUSH_JOB_PATH, notify } from '../src/notify';
import { memoryRealtime } from '../src/realtime';
import type { AppContext } from '../src/context';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const SITE = 'https://novaarena.gg';
const KEYS = { QSTASH_CURRENT_SIGNING_KEY: 'chave-atual-de-teste', QSTASH_NEXT_SIGNING_KEY: 'chave-seguinte-de-teste' };
const env = envFrom({
  NODE_ENV: 'test',
  AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
  DATABASE_URL: url,
  NEXT_PUBLIC_SITE_URL: SITE,
  ABLY_API_KEY: 'appid.keyid:segredo-do-ably-de-teste',
  VAPID_PUBLIC_KEY: 'chave-publica-vapid-de-teste',
  VAPID_PRIVATE_KEY: 'chave-privada-vapid-de-teste',
  ...KEYS,
});
const NotificationPage = page(Notification);
const Preferences = z.array(NotificationPreference);

async function sign(raw: string, path: string) {
  return new SignJWT({ body: createHash('sha256').update(raw).digest('base64url') })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('Upstash')
    .setSubject(`${SITE}/api/v1${path}`)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(KEYS.QSTASH_CURRENT_SIGNING_KEY));
}

describe.skipIf(!url)('notificações, e-mail, push e tempo real (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-7);
  const rt = memoryRealtime();
  const scheduled: ScheduledJob[] = [];
  const sent: { to: string; message: EmailMessage; key?: string }[] = [];
  /** Quantas das próximas chamadas ao Resend falham (simula a queda). */
  let resendFailures = 0;
  const pushed: { endpoint: string; payload: string }[] = [];
  const goneEndpoints = new Set<string>();
  const ids = new Map<string, string>();
  const tokens = new Map<string, string>();

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[] = ['PARTICIPANT']) {
    const nickname = `nt${key}${stamp}`.slice(0, 20);
    const user = await db.user.create({ data: { email: `nt.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), emailVerified: true, roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `nt-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    ids.set(key, user.id);
    tokens.set(key, await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles }, new Date()));
    return user;
  }
  const call = async (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(who ? { Cookie: `na_at=${tokens.get(who) ?? ''}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null };
  };
  const code = (data: unknown) => Problem.parse(data).code;
  /** O que o QStash entregaria: a mensagem agendada, assinada, na rota do job. */
  const deliver = async (job: ScheduledJob) => {
    const raw = JSON.stringify(job.body);
    const res = await app.request(`/api/v1${job.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Upstash-Signature': await sign(raw, job.path) }, body: raw });
    return { status: res.status, data: (await res.json()) as unknown };
  };
  /** Chama `notify()` como um módulo faria, com o contexto de uma requisição. */
  const notifyVia = async (userIds: string[], input: Parameters<typeof notify>[2]) => {
    const probe = createApp({ env, deps: deps() });
    probe.post('/probe', async (c) => {
      await notify(c as unknown as AppContext, userIds, input);
      return c.json({ ok: true });
    });
    await probe.request('/api/v1/probe', { method: 'POST', headers: { Origin: 'http://localhost' } });
  };
  const deps = () => ({
    db: () => db,
    realtime: () => rt,
    queue: () => ({ schedule: async (job: ScheduledJob) => void scheduled.push(job) }),
    mailer: () => ({
      mode: 'resend' as const,
      send: async (to: string, message: EmailMessage, options?: { idempotencyKey?: string }) => {
        if (resendFailures > 0) {
          resendFailures -= 1;
          throw new Error('O Resend recusou o envio (HTTP 503).');
        }
        sent.push({ to, message, key: options?.idempotencyKey });
      },
    }),
    push: (): PushSender => ({
      configured: true,
      send: async (target, payload) => {
        if (goneEndpoints.has(target.endpoint)) return 'gone';
        pushed.push({ endpoint: target.endpoint, payload });
        return 'sent';
      },
    }),
  });
  const jobsFor = (path: string, notificationId: string) => scheduled.filter((j) => j.path === path && (j.body as { notificationId: string }).notificationId === notificationId);

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: deps() });
    await makeUser('bia');
    await makeUser('lu');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('exige login', async () => {
    for (const [method, path] of [['GET', '/notifications'], ['GET', '/notifications/unread-count'], ['POST', '/notifications/read-all'], ['GET', '/me/notification-preferences'], ['GET', '/me/follows']] as const) {
      expect((await call(null, path, { method })).status).toBe(401);
    }
  });

  it('notify(): grava, avisa o canal do usuário e agenda o e-mail; contador, leitura e "ler todas"', async () => {
    const bia = ids.get('bia') ?? '';
    await notifyVia([bia, bia], { type: 'RESULT_POSTED', title: 'Resultado lançado', body: 'Quartas · Liga CR', link: '/c/liga?aba=partidas' });
    const list = NotificationPage.parse((await call('bia', '/notifications')).data);
    expect(list.items).toHaveLength(1);
    const n = list.items[0] as Notification;
    expect(n).toMatchObject({ type: 'RESULT_POSTED', title: 'Resultado lançado', readAt: null });
    expect(rt.events).toContainEqual({ channel: `user:${bia}`, event: { type: 'notification.created', id: n.id } });
    expect(jobsFor(NOTIFICATION_EMAIL_JOB_PATH, n.id)).toEqual([expect.objectContaining({ dedupId: `email-${n.id}` })]);
    // Sem assinatura de push, nenhum job de push.
    expect(jobsFor(NOTIFICATION_PUSH_JOB_PATH, n.id)).toEqual([]);
    expect(UnreadCount.parse((await call('bia', '/notifications/unread-count')).data).count).toBe(1);

    // Só o dono lê a própria notificação.
    expect((await call('lu', `/notifications/${n.id}/read`, { method: 'POST' })).status).toBe(404);
    expect((await call('lu', '/notifications/nao-e-uuid/read', { method: 'POST' })).status).toBe(404);
    const read = await call('bia', `/notifications/${n.id}/read`, { method: 'POST' });
    expect(Notification.parse(read.data).readAt).not.toBeNull();
    expect(UnreadCount.parse((await call('bia', '/notifications/unread-count')).data).count).toBe(0);

    await notifyVia([bia], { type: 'CHECKIN_OPEN', title: 'Check-in aberto', body: 'Sua partida', link: null });
    expect(UnreadCount.parse((await call('bia', '/notifications/unread-count')).data).count).toBe(1);
    expect(UnreadCount.parse((await call('bia', '/notifications/read-all', { method: 'POST' })).data).count).toBe(0);
    expect(UnreadCount.parse((await call('bia', '/notifications/unread-count')).data).count).toBe(0);
  });

  it('paginação por cursor, mais recentes primeiro, e o filtro "não lidas"', async () => {
    const lu = ids.get('lu') ?? '';
    for (let i = 1; i <= 12; i += 1) await notifyVia([lu], { type: 'ANNOUNCEMENT', title: `Comunicado ${i}`, body: 'Texto' });
    const first = NotificationPage.parse((await call('lu', '/notifications')).data);
    expect(first.items).toHaveLength(10);
    expect(first.total).toBe(12);
    expect(first.items[0]?.title).toBe('Comunicado 12');
    const second = NotificationPage.parse((await call('lu', `/notifications?cursor=${first.nextCursor}`)).data);
    expect(second.items.map((n) => n.title)).toEqual(['Comunicado 2', 'Comunicado 1']);
    expect(second.nextCursor).toBeNull();
    await call('lu', `/notifications/${first.items[0]?.id}/read`, { method: 'POST' });
    const unread = NotificationPage.parse((await call('lu', '/notifications?unread=1&limit=50')).data);
    expect(unread.items).toHaveLength(11);
    expect(unread.items.every((n) => n.readAt === null)).toBe(true);
  });

  it('preferências: tudo ligado por padrão; SANCTION não desliga; desligar no site grava só para o e-mail', async () => {
    const prefs = Preferences.parse((await call('bia', '/me/notification-preferences')).data);
    expect(prefs.every((p) => p.inApp && p.email && p.push)).toBe(true);
    for (const pref of [{ type: 'SANCTION', inApp: false, email: true }, { type: 'SANCTION', inApp: true, email: false }]) {
      expect(code((await call('bia', '/me/notification-preferences', { method: 'PUT', body: { preferences: [pref] } })).data)).toBe('SANCTION_ALWAYS_ON');
    }
    expect(code((await call('bia', '/me/notification-preferences', { method: 'PUT', body: { preferences: [{ type: 'NAO_EXISTE', inApp: true, email: true }] } })).data)).toBe('VALIDATION');

    const saved = Preferences.parse(
      (
        await call('bia', '/me/notification-preferences', {
          method: 'PUT',
          body: { preferences: [{ type: 'QUALIFIED', inApp: false, email: true }, { type: 'MATCH_SOON', inApp: true, email: false }, { type: 'ELIMINATED', inApp: false, email: false }] },
        })
      ).data,
    );
    expect(saved.find((p) => p.type === 'QUALIFIED')).toEqual({ type: 'QUALIFIED', inApp: false, email: true, push: true });

    const bia = ids.get('bia') ?? '';
    const before = scheduled.length;
    await notifyVia([bia], { type: 'QUALIFIED', title: 'Você avançou', body: 'Só por e-mail' });
    await notifyVia([bia], { type: 'ELIMINATED', title: 'Fim', body: 'Nenhum canal' });
    const list = NotificationPage.parse((await call('bia', '/notifications?limit=50')).data);
    expect(list.items.some((n) => n.title === 'Você avançou' || n.title === 'Fim')).toBe(false);
    expect(UnreadCount.parse((await call('bia', '/notifications/unread-count')).data).count).toBe(0);
    const emailOnly = await db.notification.findFirstOrThrow({ where: { userId: bia, title: 'Você avançou' } });
    expect(emailOnly.inApp).toBe(false);
    expect(await db.notification.count({ where: { userId: bia, title: 'Fim' } })).toBe(0);
    expect(scheduled.slice(before).map((j) => j.path)).toEqual([NOTIFICATION_EMAIL_JOB_PATH]);
  });

  it('e-mail: sai pelo template do tipo, uma vez só; preferência desligada não envia', async () => {
    const bia = ids.get('bia') ?? '';
    await notifyVia([bia], { type: 'TEAM_INVITE', title: 'Convite para o Squad Bravo', body: 'Você foi convidada.', link: '/minha-conta/squads' });
    const n = await db.notification.findFirstOrThrow({ where: { userId: bia, title: 'Convite para o Squad Bravo' } });
    const [job] = jobsFor(NOTIFICATION_EMAIL_JOB_PATH, n.id);
    if (!job) throw new Error('job de e-mail não agendado');

    expect((await deliver(job)).data).toMatchObject({ outcome: 'sent' });
    expect(sent.filter((s) => s.key === `notification-${n.id}`)).toHaveLength(1);
    const mail = sent.at(-1);
    expect(mail?.to).toBe(`nt.bia.${stamp}@exemplo.com`);
    expect(mail?.message).toMatchObject({ template: 'NOTIFICATION', data: { type: 'TEAM_INVITE', title: 'Convite para o Squad Bravo', link: `${SITE}/minha-conta/squads`, preferencesLink: `${SITE}/minha-conta/notificacoes` } });
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).emailSentAt).not.toBeNull();
    // Entregue de novo: não manda outra vez.
    expect((await deliver(job)).data).toMatchObject({ outcome: 'already-sent' });
    expect(sent.filter((s) => s.key === `notification-${n.id}`)).toHaveLength(1);

    // Desligou o e-mail do tipo depois do aviso, antes do envio: não manda.
    await notifyVia([bia], { type: 'MATCH_SOON', title: 'Partida em 15 minutos', body: 'Prepare-se.' });
    const soon = await db.notification.findFirstOrThrow({ where: { userId: bia, title: 'Partida em 15 minutos' } });
    expect(jobsFor(NOTIFICATION_EMAIL_JOB_PATH, soon.id)).toEqual([]);
    await call('bia', '/me/notification-preferences', { method: 'PUT', body: { preferences: [{ type: 'TEAM_INVITE', inApp: true, email: false }] } });
    await notifyVia([bia], { type: 'RESULT_POSTED', title: 'Outro resultado', body: 'x' });
    const later = await db.notification.findFirstOrThrow({ where: { userId: bia, title: 'Outro resultado' } });
    const [laterJob] = jobsFor(NOTIFICATION_EMAIL_JOB_PATH, later.id);
    await call('bia', '/me/notification-preferences', { method: 'PUT', body: { preferences: [{ type: 'RESULT_POSTED', inApp: true, email: false }] } });
    if (!laterJob) throw new Error('job de e-mail não agendado');
    expect((await deliver(laterJob)).data).toMatchObject({ outcome: 'skipped' });
    expect(sent.some((s) => s.key === `notification-${later.id}`)).toBe(false);
  });

  it('falha do Resend: 500 para o QStash tentar de novo, e a nova tentativa envia uma vez só', async () => {
    const lu = ids.get('lu') ?? '';
    await notifyVia([lu], { type: 'SANCTION', title: 'Advertência', body: 'Linguagem ofensiva no chat.' });
    const n = await db.notification.findFirstOrThrow({ where: { userId: lu, type: 'SANCTION' } });
    const [job] = jobsFor(NOTIFICATION_EMAIL_JOB_PATH, n.id);
    if (!job) throw new Error('job de e-mail não agendado');
    resendFailures = 1;
    const failed = await deliver(job);
    expect(failed.status).toBe(500);
    expect(code(failed.data)).toBe('JOB_FAILED');
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).emailSentAt).toBeNull();
    expect((await deliver(job)).status).toBe(200);
    expect((await deliver(job)).status).toBe(200);
    expect(sent.filter((s) => s.key === `notification-${n.id}`)).toHaveLength(1);
    // Sem assinatura válida do QStash: 401.
    const raw = JSON.stringify(job.body);
    expect((await app.request(`/api/v1${job.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })).status).toBe(401);
  });

  it('push: assinar, receber pelo mesmo notify(), uma vez só, e assinatura cancelada pelo navegador some', async () => {
    expect((await call(null, '/push/public-key')).data).toEqual({ publicKey: 'chave-publica-vapid-de-teste' });
    const endpoint = `https://push.exemplo.com/${stamp}/a`;
    const gone = `https://push.exemplo.com/${stamp}/b`;
    const keys = { p256dh: 'BPk3q-chave-p256dh', auth: 'segredo-auth' };
    expect((await call(null, '/me/push-subscriptions', { method: 'POST', body: { endpoint, keys } })).status).toBe(401);
    expect((await call('lu', '/me/push-subscriptions', { method: 'POST', body: { endpoint: 'nao-e-url', keys } })).status).toBe(400);
    expect((await call('lu', '/me/push-subscriptions', { method: 'POST', body: { endpoint, keys } })).status).toBe(201);
    expect((await call('lu', '/me/push-subscriptions', { method: 'POST', body: { endpoint, keys } })).status).toBe(201);
    expect((await call('lu', '/me/push-subscriptions', { method: 'POST', body: { endpoint: gone, keys } })).status).toBe(201);
    const lu = ids.get('lu') ?? '';
    expect(await db.pushSubscription.count({ where: { userId: lu } })).toBe(2);
    goneEndpoints.add(gone);

    await notifyVia([lu], { type: 'CHECKIN_OPEN', title: 'Check-in aberto', body: 'Faça o check-in.', link: '/c/copa?aba=partidas' });
    const n = await db.notification.findFirstOrThrow({ where: { userId: lu, title: 'Check-in aberto' } });
    const [job] = jobsFor(NOTIFICATION_PUSH_JOB_PATH, n.id);
    if (!job) throw new Error('job de push não agendado');
    expect((await deliver(job)).data).toMatchObject({ sent: 1, removed: 1 });
    expect(JSON.parse(pushed.at(-1)?.payload ?? '{}')).toEqual({ id: n.id, type: 'CHECKIN_OPEN', title: 'Check-in aberto', body: 'Faça o check-in.', link: '/c/copa?aba=partidas' });
    expect(await db.pushSubscription.count({ where: { userId: lu } })).toBe(1);
    expect((await deliver(job)).data).toMatchObject({ alreadySent: true });
    expect(pushed.filter((p) => p.payload.includes(n.id))).toHaveLength(1);

    // Preferência de push desligada: nem agenda.
    await call('lu', '/me/notification-preferences', { method: 'PUT', body: { preferences: [{ type: 'ANNOUNCEMENT', inApp: true, email: true, push: false }] } });
    await notifyVia([lu], { type: 'ANNOUNCEMENT', title: 'Sem push', body: 'x' });
    const quiet = await db.notification.findFirstOrThrow({ where: { userId: lu, title: 'Sem push' } });
    expect(jobsFor(NOTIFICATION_PUSH_JOB_PATH, quiet.id)).toEqual([]);

    // Cancelar a assinatura deste aparelho; a de outra conta não é tocada.
    expect((await call('bia', `/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.pushSubscription.count({ where: { userId: lu } })).toBe(1);
    expect((await call('lu', `/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.pushSubscription.count({ where: { userId: lu } })).toBe(0);
  });

  it('seguir campeonato ou jogo (RN-15): idempotente, e rascunho de outra pessoa "não existe"', async () => {
    const owner = await makeUser('org', ['ORGANIZER', 'PARTICIPANT']);
    const game = await db.game.create({ data: { slug: `nt-${stamp}`, name: `Notif ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } } }, include: { modes: true } });
    const open = await db.tournament.create({ data: { slug: `nt-aberto-${stamp}`, name: 'Aberto', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status: 'REGISTRATION_OPEN', participantType: 'SOLO', maxParticipants: 8 } });
    const draft = await db.tournament.create({ data: { slug: `nt-rascunho-${stamp}`, name: 'Rascunho', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status: 'DRAFT', participantType: 'SOLO', maxParticipants: 8 } });

    expect(FollowList.parse((await call('bia', `/me/follows/tournament/${open.slug}`, { method: 'PUT' })).data)).toEqual({ tournaments: [open.id], games: [] });
    expect(FollowList.parse((await call('bia', `/me/follows/tournament/${open.id}`, { method: 'PUT' })).data)).toEqual({ tournaments: [open.id], games: [] });
    expect(FollowList.parse((await call('bia', `/me/follows/game/${game.slug}`, { method: 'PUT' })).data)).toEqual({ tournaments: [open.id], games: [game.id] });
    expect((await call('bia', `/me/follows/tournament/${draft.slug}`, { method: 'PUT' })).status).toBe(404);
    expect((await call('org', `/me/follows/tournament/${draft.slug}`, { method: 'PUT' })).status).toBe(200);
    expect((await call('bia', '/me/follows/time/qualquer', { method: 'PUT' })).status).toBe(404);
    expect(FollowList.parse((await call('bia', `/me/follows/game/${game.id}`, { method: 'DELETE' })).data)).toEqual({ tournaments: [open.id], games: [] });
    expect(FollowList.parse((await call('bia', '/me/follows')).data)).toEqual({ tournaments: [open.id], games: [] });
  });

  describe('token do tempo real (issue #97)', () => {
    let tournamentId = '';
    let first: Match;
    let second: Match;
    const regOf = new Map<string, string>();

    beforeAll(async () => {
      const owner = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
      const mod = await makeUser('mod');
      await makeUser('fora');
      const game = await db.game.create({
        data: { slug: `rt-${stamp}`, name: `Tempo real ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
        include: { modes: true, scoringModels: true },
      });
      const t = await db.tournament.create({ data: { slug: `copa-rt-${stamp}`, name: 'Copa do Tempo Real', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status: 'REGISTRATION_CLOSED', participantType: 'SOLO', maxParticipants: 4 } });
      tournamentId = t.id;
      await db.tournamentStaff.create({ data: { tournamentId: t.id, userId: mod.id, role: 'MODERATOR', addedById: owner.id } });
      const stage = await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'], config: { bestOf: 1 } } });
      for (const key of ['p1', 'p2', 'p3', 'p4']) {
        const u = await makeUser(key);
        regOf.set(key, (await db.registration.create({ data: { tournamentId: t.id, userId: u.id, status: 'CONFIRMED' } })).id);
      }
      await call('dono', `/stages/${stage.id}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
      await call('dono', `/stages/${stage.id}/confirm`, { method: 'POST' });
      const all = z.array(Match).parse((await call('dono', `/tournaments/${t.id}/matches`)).data).filter((m) => m.round === 1);
      [first, second] = all as [Match, Match];
    });

    const capabilityOf = async (who: string | null, channels?: string[]) => {
      const res = await call(who, '/realtime/token', { method: 'POST', body: channels ? { channels } : {} });
      expect(res.status).toBe(200);
      const request = RealtimeTokenRequest.parse(res.data);
      return { request, capability: JSON.parse(request.capability) as Record<string, string[]> };
    };
    const playerOf = (m: Match) => [...regOf.entries()].find(([, r]) => r === m.participants[0]?.registrationId)?.[0] ?? '';

    it('visitante: só `tournament:*`, sem `user:*` e sem partida, mesmo pedindo', async () => {
      const { request, capability } = await capabilityOf(null, [`match:${first.id}`]);
      expect(capability).toEqual({ 'tournament:*': ['subscribe'] });
      expect(request.clientId).toBeUndefined();
      expect(request.keyName).toBe('appid.keyid');
      expect(JSON.stringify(request)).not.toContain('segredo-do-ably-de-teste');
    });

    it('participante: o próprio `user:` e a própria partida; a de outra partida é descartada', async () => {
      const player = playerOf(first);
      const { request, capability } = await capabilityOf(player, [`match:${first.id}`, `match:${second.id}`, 'user:outra-pessoa', 'match:nao-e-uuid']);
      expect(request.clientId).toBeUndefined();
      expect(capability).toEqual({ 'tournament:*': ['subscribe'], [`user:${ids.get(player)}`]: ['subscribe'], [`match:${first.id}`]: ['subscribe'] });
      expect(capability[`match:${second.id}`]).toBeUndefined();
      // Quem não está no campeonato não assina nenhuma partida.
      expect(Object.keys((await capabilityOf('fora', [`match:${first.id}`])).capability).filter((k) => k.startsWith('match:'))).toEqual([]);
    });

    it('organização (dono e moderador) assina qualquer partida do campeonato', async () => {
      for (const who of ['dono', 'mod']) {
        const { capability } = await capabilityOf(who, [`match:${first.id}`, `match:${second.id}`]);
        expect(capability[`match:${first.id}`]).toEqual(['subscribe']);
        expect(capability[`match:${second.id}`]).toEqual(['subscribe']);
      }
      expect(tournamentId).toBeTruthy();
    });

    it('sem ABLY_API_KEY: 503 REALTIME_UNAVAILABLE (a tela cai para o polling de 10 s)', async () => {
      const bare = createApp({ env: envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url }), deps: { db: () => db } });
      const res = await bare.request('/api/v1/realtime/token', { method: 'POST', headers: { Origin: 'http://localhost' } });
      expect(res.status).toBe(503);
      expect(code(await res.json())).toBe('REALTIME_UNAVAILABLE');
    });
  });
});
