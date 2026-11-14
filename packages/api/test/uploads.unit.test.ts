/** Uploads sem banco (issue #73): o token de envio só sai para imagem de até 5 MB, no caminho da própria pessoa. */
import type { PrismaClient } from '@nova/db';
import { Problem, UPLOAD_MAX_BYTES } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { createApp, envFrom } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import type { BlobStore } from '../src/uploads/store';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const USER = '11111111-1111-4111-8111-111111111111';
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_lojateste_segredo123456' });

/** Banco falso: só a sessão da pessoa de teste existe. */
const sessionDb = (() => ({
  session: { findUnique: async () => ({ revokedAt: null, userId: USER, twoFactorVerified: false, user: { status: 'ACTIVE', sessionVersion: 0 } }) },
})) as unknown as () => PrismaClient;

async function cookie() {
  return `na_at=${await signAccessToken(env, { sub: USER, sid: 's1', sv: 0, tfa: false, roles: ['PARTICIPANT'] }, new Date())}`;
}

function tokenEvent(pathname: string, payload: unknown) {
  return { type: 'blob.generate-client-token', payload: { pathname, clientPayload: JSON.stringify(payload), multipart: false } };
}

async function ask(app: ReturnType<typeof createApp>, event: unknown) {
  return app.request('/api/v1/uploads/blob', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', Cookie: await cookie() }, body: JSON.stringify(event) });
}

describe('token de envio', () => {
  const issued: unknown[] = [];
  const spy: BlobStore = {
    clientToken: async ({ onBeforeGenerateToken }) => {
      issued.push(await onBeforeGenerateToken('x', null, false));
      return { type: 'blob.generate-client-token', clientToken: 'token-de-teste' };
    },
    head: async () => null,
    read: async () => null,
  };
  const app = createApp({ env, deps: { db: sessionDb, blob: spy } });
  const ok = { purpose: 'evidence', contentType: 'image/jpeg', size: 300_000 };

  it('Token recusado para arquivo que não é imagem', async () => {
    const res = await ask(app, tokenEvent(`evidence/${USER}/prova.pdf`, { ...ok, contentType: 'application/pdf' }));
    expect(res.status).toBe(400);
    expect(Problem.parse(await res.json()).code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it('Token recusado para arquivo maior que 5 MB', async () => {
    const res = await ask(app, tokenEvent(`evidence/${USER}/prova.jpg`, { ...ok, size: UPLOAD_MAX_BYTES + 1 }));
    expect(res.status).toBe(400);
    expect(Problem.parse(await res.json()).code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it('finalidade desconhecida ou caminho de outra pessoa: recusado', async () => {
    expect((await ask(app, tokenEvent(`evidence/${USER}/a.jpg`, { ...ok, purpose: 'qualquer' }))).status).toBe(400);
    const other = await ask(app, tokenEvent('evidence/22222222-2222-4222-8222-222222222222/a.jpg', ok));
    expect(Problem.parse(await other.json()).code).toBe('UPLOAD_PATH');
    expect((await ask(app, tokenEvent(`evidence/${USER}/../avatar/a.jpg`, ok))).status).toBe(400);
  });

  it('imagem válida: o token também limita tipo, tamanho e validade no próprio Blob', async () => {
    const res = await ask(app, tokenEvent(`evidence/${USER}/prova.jpg`, ok));
    expect(res.status).toBe(200);
    expect(issued.at(-1)).toMatchObject({ allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'], maximumSizeInBytes: UPLOAD_MAX_BYTES, addRandomSuffix: true });
    expect(JSON.parse((issued.at(-1) as { tokenPayload: string }).tokenPayload)).toEqual({ userId: USER, purpose: 'evidence' });
  });

  it('visitante não pede token; aviso de conclusão do Blob não é aceito por esta rota', async () => {
    const anon = await app.request('/api/v1/uploads/blob', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(tokenEvent('x', ok)) });
    expect(anon.status).toBe(401);
    expect((await ask(app, { type: 'blob.upload-completed', payload: {} })).status).toBe(400);
  });

  it('com o @vercel/blob de verdade, devolve um token de cliente', async () => {
    const real = createApp({ env, deps: { db: sessionDb } });
    const res = await ask(real, tokenEvent(`avatar/${USER}/foto.jpg`, { ...ok, purpose: 'avatar' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { clientToken: string }).clientToken).toMatch(/^vercel_blob_client_/);
  });

  it('sem Blob configurado: 503 com mensagem para a pessoa', async () => {
    const off = createApp({ env: envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET }), deps: { db: sessionDb, blob: spy } });
    const res = await ask(off, tokenEvent(`evidence/${USER}/prova.jpg`, ok));
    expect(res.status).toBe(503);
    expect(Problem.parse(await res.json()).code).toBe('UPLOADS_UNAVAILABLE');
  });
});
