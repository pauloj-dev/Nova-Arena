/**
 * Jobs contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI) — issue #99.
 * Critério de aceite: qualquer job executado duas vezes não duplica efeito.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { JobFailureList } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { dailyCleanup } from '../src/jobs/cleanup';
import { sweep } from '../src/jobs/sweep';
import { createLogger } from '../src/logger';
import type { BlobStore } from '../src/uploads/store';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_lojateste_segredo123456', CRON_SECRET: 'segredo-do-cron' });
const DAY = 24 * 3600_000;

describe.skipIf(!url)('jobs (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const removed: string[] = [];
  const blob: BlobStore = { clientToken: async () => ({}), head: async () => null, read: async () => null, remove: async (u) => void removed.push(u) };
  const log = createLogger(() => undefined);
  const stamp = String(Date.now()).slice(-7);
  let userId = '';
  const cookies = new Map<string, string>();

  async function makeUser(key: string, roles: ('ADMIN' | 'PARTICIPANT')[]) {
    const nickname = `jb${key}${stamp}`;
    const user = await db.user.create({ data: { email: `jb.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `jb-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: true, roles }, new Date())}`);
    return user;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db, blob } });
    userId = (await makeUser('jog', ['PARTICIPANT'])).id;
    await makeUser('adm', ['ADMIN', 'PARTICIPANT']);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('limpeza diária: convites vencidos, uploads órfãos, tokens e sessões velhos — e a segunda rodada não muda nada', async () => {
    const now = new Date();
    const team = await db.team.create({ data: { name: 'Squad Job', tag: `J${stamp.slice(-3)}`, captainId: userId, members: { create: { userId, role: 'CAPTAIN' } } } });
    const expired = await db.teamInvite.create({ data: { teamId: team.id, code: `X${stamp.slice(-5)}`, createdById: userId, expiresAt: new Date(now.getTime() - 1000) } });
    const valid = await db.teamInvite.create({ data: { teamId: team.id, code: `Y${stamp.slice(-5)}`, createdById: userId, expiresAt: new Date(now.getTime() + DAY) } });
    const orphan = await db.upload.create({ data: { ownerId: userId, purpose: 'evidence', access: 'private', blobUrl: `https://loja/evidence/${userId}/velho-${stamp}.jpg`, pathname: 'x', contentType: 'image/jpeg', size: 10, createdAt: new Date(now.getTime() - 2 * DAY) } });
    const fresh = await db.upload.create({ data: { ownerId: userId, purpose: 'evidence', access: 'private', blobUrl: `https://loja/evidence/${userId}/novo-${stamp}.jpg`, pathname: 'y', contentType: 'image/jpeg', size: 10 } });
    const attached = await db.upload.create({ data: { ownerId: userId, purpose: 'avatar', blobUrl: `https://loja/avatar/${userId}/usado-${stamp}.jpg`, pathname: 'z', contentType: 'image/jpeg', size: 10, createdAt: new Date(now.getTime() - 3 * DAY), attachedAt: new Date(), attachedType: 'USER', attachedId: userId } });
    const oldToken = await db.emailToken.create({ data: { userId, type: 'VERIFY', tokenHash: `jb-${randomUUID()}`, expiresAt: new Date(now.getTime() - 8 * DAY) } });
    const oldSession = await db.session.create({ data: { userId, familyId: randomUUID(), refreshTokenHash: `jb-${randomUUID()}`, expiresAt: new Date(now.getTime() - 31 * DAY) } });

    const first = await dailyCleanup({ db, blob, env, log }, now);
    expect(first.invitesExpired).toBeGreaterThanOrEqual(1);
    expect(first.uploadsDeleted).toBeGreaterThanOrEqual(1);
    expect((await db.teamInvite.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe('EXPIRED');
    expect((await db.teamInvite.findUniqueOrThrow({ where: { id: valid.id } })).status).toBe('PENDING');
    expect(await db.upload.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(removed).toContain(orphan.blobUrl);
    expect(await db.upload.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.upload.findUnique({ where: { id: attached.id } })).not.toBeNull();
    expect(await db.emailToken.findUnique({ where: { id: oldToken.id } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: oldSession.id } })).toBeNull();

    // Segunda rodada: nada deste teste muda (o que já foi limpo não volta a contar).
    const before = removed.length;
    await dailyCleanup({ db, blob, env, log }, now);
    expect(removed.slice(before)).not.toContain(orphan.blobUrl);
    expect((await db.teamInvite.findUniqueOrThrow({ where: { id: valid.id } })).status).toBe('PENDING');
    expect(await db.upload.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it('varredura: reserva vencida volta ao fim da fila e a vaga anda; repetir não muda nada', async () => {
    const game = await db.game.create({
      data: { slug: `jb-${stamp}`, name: `Jobs ${stamp}`, modes: { create: { name: '2x2', teamSize: 2, matchType: 'TEAM_VS_TEAM' } }, scoringModels: { create: { name: 'V', matchType: 'TEAM_VS_TEAM', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true },
    });
    const t = await db.tournament.create({ data: { slug: `copa-jb-${stamp}`, name: 'Copa Jobs', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: userId, status: 'REGISTRATION_OPEN', participantType: 'TEAM', maxParticipants: 1 } });
    // Squad promovido incompleto com a reserva vencida, e outro esperando completo na fila.
    const stale = await db.registration.create({ data: { tournamentId: t.id, displayName: 'Atrasado', status: 'PENDING_MEMBERS', reservedUntil: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 3 * DAY) } });
    const next = await db.registration.create({ data: { tournamentId: t.id, displayName: 'Pronto', status: 'WAITLIST', createdAt: new Date(Date.now() - 2 * DAY) } });

    const first = await sweep(db, new Date());
    expect(first.waitlistsSettled).toBeGreaterThanOrEqual(1);
    const after1 = await db.registration.findMany({ where: { tournamentId: t.id }, orderBy: { createdAt: 'asc' } });
    expect(after1.find((r) => r.id === next.id)?.status).toBe('CONFIRMED');
    expect(after1.find((r) => r.id === stale.id)).toMatchObject({ status: 'WAITLIST', reservedUntil: null });

    await sweep(db, new Date());
    const after2 = await db.registration.findMany({ where: { tournamentId: t.id }, orderBy: { createdAt: 'asc' } });
    expect(after2.map((r) => [r.id, r.status])).toEqual(after1.map((r) => [r.id, r.status]));
  });

  it('cron pela rota com o segredo; falhas definitivas para o Admin, que marca como resolvida', async () => {
    expect((await app.request('/api/v1/cron/daily-cleanup', { headers: { Authorization: 'Bearer segredo-do-cron' } })).status).toBe(200);
    const failure = await db.jobFailure.create({ data: { job: `teste-${stamp}`, source: 'cron', error: 'falha de teste' } });
    expect((await app.request('/api/v1/admin/system/job-failures', { headers: { Cookie: cookies.get('jog') ?? '' } })).status).toBe(403);
    const list = JobFailureList.parse(await (await app.request('/api/v1/admin/system/job-failures', { headers: { Cookie: cookies.get('adm') ?? '' } })).json());
    expect(list.open).toBeGreaterThanOrEqual(1);
    expect(list.items.map((f) => f.id)).toContain(failure.id);
    const resolve = () => app.request(`/api/v1/admin/system/job-failures/${failure.id}/resolve`, { method: 'POST', headers: { Origin: 'http://localhost', Cookie: cookies.get('adm') ?? '' } });
    expect((await resolve()).status).toBe(200);
    const once = (await db.jobFailure.findUniqueOrThrow({ where: { id: failure.id } })).resolvedAt;
    await resolve();
    expect((await db.jobFailure.findUniqueOrThrow({ where: { id: failure.id } })).resolvedAt).toEqual(once);
  });
});
