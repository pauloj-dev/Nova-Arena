/**
 * Vercel Blob (issue #73). O arquivo vai do navegador direto para o Blob; a API só emite o token, confere o
 * resultado e, para os arquivos privados, serve o conteúdo depois de conferir a permissão.
 *
 * Duas lojas: a pública (`BLOB_READ_WRITE_TOKEN`: avatar, logos, capas) e a privada
 * (`BLOB_PRIVATE_READ_WRITE_TOKEN`, ou a mesma com acesso privado: provas e denúncias).
 */
import { isPrivateUpload, type UploadPurpose } from '@nova/schemas';
import { get, head } from '@vercel/blob';
import { handleUpload, type HandleUploadBody, type HandleUploadOptions } from '@vercel/blob/client';
import type { Env } from '../env';
import { HttpProblem } from '../errors';

export interface StoredBlob {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
}

export interface BlobStore {
  /** Gera o token do envio direto (o `@vercel/blob/client` do navegador chama esta rota). */
  clientToken(input: { token: string; request: Request; body: HandleUploadBody; onBeforeGenerateToken: HandleUploadOptions['onBeforeGenerateToken'] }): Promise<unknown>;
  /** Metadados do arquivo enviado, ou `null` se não existe. */
  head(url: string, token: string): Promise<StoredBlob | null>;
  /** Conteúdo de um arquivo privado. */
  read(url: string, token: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; size: number } | null>;
}

export const vercelBlobStore: BlobStore = {
  clientToken: ({ token, request, body, onBeforeGenerateToken }) => handleUpload({ token, request, body, onBeforeGenerateToken }),
  async head(url, token) {
    try {
      const blob = await head(url, { token });
      return { url: blob.url, pathname: blob.pathname, contentType: blob.contentType, size: blob.size };
    } catch {
      return null;
    }
  },
  async read(url, token) {
    const result = await get(url, { access: 'private', token, useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { stream: result.stream, contentType: result.blob.contentType, size: result.blob.size };
  },
};

/** Token da loja certa para a finalidade. Sem Blob configurado → 503 com mensagem para a pessoa. */
export function storeToken(env: Env, purpose: UploadPurpose): string {
  const token = isPrivateUpload(purpose) ? (env.BLOB_PRIVATE_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN) : env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new HttpProblem(503, 'O envio de imagens está indisponível no momento. Tente mais tarde.', 'UPLOADS_UNAVAILABLE');
  return token;
}

/** Todo arquivo fica em `<finalidade>/<id da pessoa>/…`: é assim que a API sabe de quem é. */
export const uploadPrefix = (purpose: UploadPurpose, userId: string) => `${purpose}/${userId}/`;
