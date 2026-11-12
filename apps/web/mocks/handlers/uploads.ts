/**
 * Módulo `uploads` da API simulada. Reproduz o fluxo do Vercel Blob (plano §2.4):
 * a API só emite um token (validando tipo e tamanho); o arquivo vai do navegador direto
 * para o armazenamento. Aqui o "armazenamento" devolve o próprio arquivo como data URL.
 */
import { http } from 'msw';
import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, UploadTokenInput } from '@nova/schemas';
import { collection, nowIso, save, uid } from '../db';
import { badRequest, body, handle, HttpProblem, json, param, requireUser, url } from '../http';

export const moduleName = 'uploads';

interface DbUploadToken {
  token: string;
  userId: string;
  purpose: string;
  contentType: string;
  size: number;
  expiresAt: string;
  usedAt: string | null;
}
const tokens = () => collection<DbUploadToken>('uploadTokens');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export const handlers = [
  http.post(
    url('/uploads/token'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, UploadTokenInput);
      const token = uid('up');
      tokens().push({ token, userId: user.id, purpose: input.purpose, contentType: input.contentType, size: input.size, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), usedAt: null });
      save();
      return json({ uploadUrl: `/api/v1/uploads/${token}`, token, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    }),
  ),

  http.put(
    url('/uploads/:token'),
    handle(async ({ params, request }) => {
      const user = requireUser();
      const record = tokens().find((t) => t.token === param(params, 'token'));
      if (!record || record.userId !== user.id || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
        throw new HttpProblem(403, 'Autorização de envio inválida ou expirada.', 'UPLOAD_TOKEN_INVALID');
      }
      const contentType = request.headers.get('Content-Type') ?? '';
      const bytes = new Uint8Array(await request.arrayBuffer());
      // O armazenamento confere de novo o que o token autorizou.
      if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(contentType) || contentType !== record.contentType) throw badRequest('Tipo de arquivo não permitido.', 'UPLOAD_TYPE');
      if (bytes.length > UPLOAD_MAX_BYTES || bytes.length > record.size) throw badRequest('O arquivo é maior do que o autorizado.', 'UPLOAD_SIZE');
      record.usedAt = nowIso();
      save();
      return json({ url: `data:${contentType};base64,${toBase64(bytes)}` });
    }),
  ),
];
