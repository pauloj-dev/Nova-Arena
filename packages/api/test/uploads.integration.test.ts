/**
 * Uploads contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): confirmação do envio, associação ao
 * recurso e leitura dos arquivos privados (issue #73). O Blob é falso.
 * Critério de aceite: print de uma disputa não abre para quem não é parte nem staff.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Problem, UploadedFile } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { attachUpload } from '../src/modules/uploads';
import type { BlobStore, StoredBlob } from '../src/uploads/store';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_lojateste_segredo123456' });
const BLOB = 'https://lojateste.private.blob.vercel-storage.com';

describe.skipIf(!url)('uploads (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-8);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const files = new Map<string, StoredBlob>();
  let disputeId = '';

  const fakeBlob: BlobStore = {
    clientToken: async () => ({}),
    head: async (u) => files.get(u) ?? null,
    read: async (u) => (files.has(u) ? { stream: new Blob(['imagem']).stream(), contentType: 'image/jpeg', size: 6 } : null),
  };

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[] = ['PARTICIPANT']) {
    const nickname = `up${key}${stamp}`;
    const user = await db.user.create({ data: { email: `up.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `up-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles }, new Date())}`);
    ids.set(key, user.id);
    return user;
  }

  const call = (who: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', Cookie: cookies.get(who) ?? '' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  /** Simula o navegador: arquivo no Blob, no caminho da pessoa. */
  function storeFile(owner: string, purpose: string, contentType = 'image/jpeg', size = 200_000) {
    const pathname = `${purpose}/${ids.get(owner)}/print-${randomUUID()}.jpg`;
    const fileUrl = `${BLOB}/${pathname}`;
    files.set(fileUrl, { url: fileUrl, pathname, contentType, size });
    return fileUrl;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db, blob: fakeBlob } });
    const jogadora = await makeUser('jog');
    const rival = await makeUser('riv');
    await makeUser('estranho');
    const dono = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    const moderador = await makeUser('mod');
    await makeUser('adm', ['ADMIN', 'PARTICIPANT']);

    const game = await db.game.create({ data: { slug: `up-${stamp}`, name: 'Jogo Upload', modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } } }, include: { modes: true } });
    const t = await db.tournament.create({
      data: { slug: `copa-up-${stamp}`, name: 'Copa Upload', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: dono.id, participantType: 'SOLO', maxParticipants: 8, staff: { create: { userId: moderador.id, role: 'MODERATOR', addedById: dono.id } } },
    });
    const r1 = await db.registration.create({ data: { tournamentId: t.id, userId: jogadora.id, status: 'CONFIRMED' } });
    const r2 = await db.registration.create({ data: { tournamentId: t.id, userId: rival.id, status: 'CONFIRMED' } });
    const model = await db.scoringModel.create({ data: { gameId: game.id, name: 'Vitória', matchType: 'DUEL', rules: {}, tiebreakers: [] } });
    const stage = await db.stage.create({ data: { tournamentId: t.id, name: 'Chave', order: 1, format: 'SINGLE_ELIM', scoringModelId: model.id } });
    const match = await db.match.create({ data: { stageId: stage.id, nodeId: 'w-r1-m1', round: 1, position: 1, participants: { create: [{ registrationId: r1.id, slot: 1 }, { registrationId: r2.id, slot: 2 }] } } });
    disputeId = (await db.dispute.create({ data: { matchId: match.id, openedById: jogadora.id, reason: 'O placar enviado está errado.' } })).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('confirma o envio: prova vira endereço privado da API; avatar fica com o endereço público', async () => {
    const proof = await call('jog', '/uploads/complete', { method: 'POST', body: { url: storeFile('jog', 'evidence'), purpose: 'evidence' } });
    expect(proof.status).toBe(201);
    const file = UploadedFile.parse(await proof.json());
    expect(file.access).toBe('private');
    expect(file.url).toBe(`/api/v1/files/${file.id}`);

    const avatarUrl = storeFile('jog', 'avatar');
    const avatar = UploadedFile.parse(await (await call('jog', '/uploads/complete', { method: 'POST', body: { url: avatarUrl, purpose: 'avatar' } })).json());
    expect(avatar).toMatchObject({ access: 'public', url: avatarUrl });
  });

  it('não aceita arquivo de outra pessoa, inexistente, fora do tipo ou da finalidade', async () => {
    expect((await call('estranho', '/uploads/complete', { method: 'POST', body: { url: storeFile('jog', 'evidence'), purpose: 'evidence' } })).status).toBe(403);
    expect(Problem.parse(await (await call('jog', '/uploads/complete', { method: 'POST', body: { url: `${BLOB}/evidence/nada.jpg`, purpose: 'evidence' } })).json()).code).toBe('UPLOAD_NOT_FOUND');
    expect(Problem.parse(await (await call('jog', '/uploads/complete', { method: 'POST', body: { url: storeFile('jog', 'evidence', 'image/gif'), purpose: 'evidence' } })).json()).code).toBe('UPLOAD_TYPE');
    // Arquivo enviado como avatar não vira prova.
    expect((await call('jog', '/uploads/complete', { method: 'POST', body: { url: storeFile('jog', 'avatar'), purpose: 'evidence' } })).status).toBe(403);
  });

  it('Print de uma disputa não abre para quem não é parte nem staff', async () => {
    const res = await call('jog', '/uploads/complete', { method: 'POST', body: { url: storeFile('jog', 'evidence'), purpose: 'evidence' } });
    const file = UploadedFile.parse(await res.json());
    const path = `/files/${file.id}`;

    // Antes de associar: só quem enviou.
    expect((await call('riv', path)).status).toBe(403);
    await attachUpload(db, { url: file.url, ownerId: ids.get('jog') ?? '', purpose: 'evidence', attachedType: 'DISPUTE', attachedId: disputeId, now: new Date() });

    for (const who of ['jog', 'riv', 'dono', 'mod', 'adm']) {
      const ok = await call(who, path);
      expect(ok.status, who).toBe(200);
      expect(ok.headers.get('cache-control')).toBe('private, no-store');
    }
    const stranger = await call('estranho', path);
    expect(stranger.status).toBe(403);
    expect(Problem.parse(await stranger.json()).code).toBe('FILE_FORBIDDEN');
    // Associar de novo (ou por outra pessoa) não é possível.
    await expect(attachUpload(db, { url: file.url, ownerId: ids.get('jog') ?? '', purpose: 'evidence', attachedType: 'MATCH', attachedId: randomUUID(), now: new Date() })).rejects.toThrow();
  });

  it('denúncia: só quem denunciou e a moderação', async () => {
    const res = await call('jog', '/uploads/complete', { method: 'POST', body: { url: storeFile('jog', 'report'), purpose: 'report' } });
    const file = UploadedFile.parse(await res.json());
    await attachUpload(db, { url: file.url, ownerId: ids.get('jog') ?? '', purpose: 'report', attachedType: 'REPORT', attachedId: randomUUID(), now: new Date() });
    expect((await call('jog', `/files/${file.id}`)).status).toBe(200);
    expect((await call('adm', `/files/${file.id}`)).status).toBe(200);
    expect((await call('dono', `/files/${file.id}`)).status).toBe(403);
  });
});
