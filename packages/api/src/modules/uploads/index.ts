/**
 * Uploads (issue #73, plano §2.4, RNF-09).
 *
 * 1. `POST /uploads/blob`: o `@vercel/blob/client` do navegador pede o token. A API confere a sessão, a
 *    finalidade, o tipo (PNG, JPG ou WebP) e o tamanho (até 5 MB) e só então emite um token que o próprio
 *    Blob também limita a esses tipos e tamanho, no caminho `<finalidade>/<id da pessoa>/`.
 * 2. O arquivo vai do navegador direto para o Blob (não passa pela função).
 * 3. `POST /uploads/complete`: a API confere no Blob que o arquivo existe, é da pessoa e está dentro das
 *    regras, e registra. Só esse endereço pode ser associado a um recurso (`attachUpload`); sem recurso em
 *    24 h vira órfão (limpeza diária em B2).
 * 4. `GET /files/:id`: arquivos privados (provas e denúncias) só saem por aqui, depois de `canReadUpload`.
 */
import type { PrismaClient } from '@nova/db';
import { CompleteUploadInput, isPrivateUpload, UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, UploadedFile, UploadTokenInput, type UploadPurpose } from '@nova/schemas';
import type { HandleUploadBody } from '@vercel/blob/client';
import { Hono } from 'hono';
import { body, respond, type AppEnv } from '../../context';
import { badRequest, fieldErrors, forbidden, HttpProblem, notFound } from '../../errors';
import { currentRoles } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { canReadUpload } from '../../uploads/access';
import { storeToken, uploadPrefix } from '../../uploads/store';

/** Validade do token de envio. */
const TOKEN_TTL_MS = 5 * 60_000;

function parseJson(raw: string | null | undefined): unknown {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
}

const fileUrl = (upload: { id: string; access: string; blobUrl: string }) => (upload.access === 'private' ? `/api/v1/files/${upload.id}` : upload.blobUrl);

/**
 * Associa um arquivo confirmado a um recurso (usado pelas rotas de provas, logos e capas). Aceita o endereço
 * devolvido por `/uploads/complete`. Arquivo de outra pessoa, de outra finalidade ou já usado → 400.
 */
export async function attachUpload(db: PrismaClient, input: { url: string; ownerId: string; purpose: UploadPurpose; attachedType: string; attachedId: string; now: Date }): Promise<void> {
  const privateId = /^\/api\/v1\/files\/([0-9a-f-]{36})$/i.exec(input.url)?.[1];
  const where = privateId ? { id: privateId } : { blobUrl: input.url };
  const { count } = await db.upload.updateMany({
    where: { ...where, ownerId: input.ownerId, purpose: input.purpose, attachedAt: null },
    data: { attachedType: input.attachedType, attachedId: input.attachedId, attachedAt: input.now },
  });
  if (count === 0) throw badRequest('Esta imagem não foi enviada por você ou já foi usada. Envie de novo.', 'UPLOAD_NOT_FOUND');
}

export const uploads = new Hono<AppEnv>();

uploads.post('/uploads/blob', async (c) => {
  const session = await requireSession(c);
  const event = (await c.req.json().catch(() => null)) as HandleUploadBody | null;
  // Sem `onUploadCompleted`: a confirmação é o `/uploads/complete`, que funciona também fora da Vercel.
  if (!event || event.type !== 'blob.generate-client-token') throw badRequest('Pedido de envio inválido.', 'INVALID_BODY');

  // Recusa antes de emitir: só imagem, até 5 MB, finalidade conhecida.
  const parsed = UploadTokenInput.safeParse(parseJson(event.payload.clientPayload));
  if (!parsed.success) throw new HttpProblem(400, 'Envie uma imagem PNG, JPG ou WebP de até 5 MB.', 'UPLOAD_NOT_ALLOWED', fieldErrors(parsed.error));
  const { purpose } = parsed.data;
  const prefix = uploadPrefix(purpose, session.userId);
  if (!event.payload.pathname.startsWith(prefix) || event.payload.pathname.includes('..')) throw badRequest('Destino do arquivo inválido.', 'UPLOAD_PATH');

  const now = c.get('deps').now();
  const result = await c.get('deps').blob.clientToken({
    token: storeToken(c.get('env'), purpose),
    request: c.req.raw,
    body: event,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: [...UPLOAD_MIME_TYPES],
      maximumSizeInBytes: UPLOAD_MAX_BYTES,
      addRandomSuffix: true,
      validUntil: now.getTime() + TOKEN_TTL_MS,
      tokenPayload: JSON.stringify({ userId: session.userId, purpose }),
    }),
  });
  return c.json(result);
});

uploads.post('/uploads/complete', async (c) => {
  const session = await requireSession(c);
  const { url, purpose } = await body(c, CompleteUploadInput);
  const db = c.get('deps').db();

  const existing = await db.upload.findUnique({ where: { blobUrl: url } });
  if (existing) {
    if (existing.ownerId !== session.userId) throw forbidden();
    return respond(c, UploadedFile, { id: existing.id, url: fileUrl(existing), access: existing.access as 'public' | 'private' });
  }

  const stored = await c.get('deps').blob.head(url, storeToken(c.get('env'), purpose));
  if (!stored) throw badRequest('Não encontramos a imagem enviada. Tente de novo.', 'UPLOAD_NOT_FOUND');
  // O Blob já barra tipo e tamanho pelo token; conferimos de novo antes de aceitar.
  if (!stored.pathname.startsWith(uploadPrefix(purpose, session.userId))) throw forbidden('Esta imagem não foi enviada por você.');
  if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(stored.contentType)) throw badRequest('Envie uma imagem PNG, JPG ou WebP.', 'UPLOAD_TYPE');
  if (stored.size > UPLOAD_MAX_BYTES) throw badRequest('A imagem pode ter no máximo 5 MB.', 'UPLOAD_SIZE');

  const access = isPrivateUpload(purpose) ? 'private' : 'public';
  const upload = await db.upload.create({
    data: { ownerId: session.userId, purpose, access, blobUrl: stored.url, pathname: stored.pathname, contentType: stored.contentType, size: stored.size },
  });
  return respond(c, UploadedFile, { id: upload.id, url: fileUrl(upload), access }, 201);
});

/** Arquivo privado: confere quem pede e entrega o conteúdo sem cache compartilhado. */
uploads.get('/files/:id', async (c) => {
  const session = await requireSession(c);
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Arquivo');
  const db = c.get('deps').db();
  const upload = await db.upload.findUnique({ where: { id } });
  if (!upload || upload.access !== 'private') throw notFound('Arquivo');
  const roles = await currentRoles(c);
  if (!(await canReadUpload(db, { id: session.userId, roles }, upload))) throw forbidden('Só as partes da partida e a organização do campeonato podem ver esta imagem.', 'FILE_FORBIDDEN');

  const file = await c.get('deps').blob.read(upload.blobUrl, storeToken(c.get('env'), upload.purpose as UploadPurpose));
  if (!file) throw notFound('Arquivo');
  return new Response(file.stream, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
});
