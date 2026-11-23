import { isPrivateUpload, Me, UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, UploadedFile, UploadResult, UploadToken, type UploadPurpose } from '@nova/schemas';
import { getT } from '../i18n/core';
import { sharedMessages } from '../i18n/messages';
import { api, ApiError } from './client';
import { isModuleMocked } from './mode';

export type { UploadPurpose };

export class UploadError extends Error {}

/** Confere tipo e tamanho antes de qualquer envio (RNF-09). Devolve a mensagem de erro ou nulo. */
export function validateImage(file: Pick<File, 'type' | 'size'>): string | null {
  const t = getT(sharedMessages, 'upload');
  if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) return t('tipoInvalido');
  if (file.size > UPLOAD_MAX_BYTES) return t('grandeDemais');
  return null;
}

/** Dimensões finais mantendo a proporção, sem nunca aumentar a imagem. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Comprime no navegador (redimensiona e reencoda em JPEG) para o envio ficar leve no 4G. */
export async function compressImage(file: Blob, opts: { maxSide?: number; quality?: number } = {}): Promise<Blob> {
  const { maxSide = 1280, quality = 0.72 } = opts;
  const t = getT(sharedMessages, 'upload');
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadError(t('prepararImagem'));
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new UploadError(t('comprimirImagem'));
  return blob;
}

/** Andamento de um envio: `preparing` (validando e comprimindo) e `uploading` (bytes indo para o armazenamento). */
export interface UploadProgress {
  phase: 'preparing' | 'uploading';
  /** 0 a 100, sempre crescente. */
  percent: number;
}

export interface UploadImageOptions {
  maxSide?: number;
  quality?: number;
  /** Chamado a cada avanço (preparação até 15%, depois o envio dos bytes até 100%). */
  onProgress?: (progress: UploadProgress) => void;
}

const PREPARED = 15;

/** PUT com XMLHttpRequest: é o único jeito de saber quantos bytes já subiram (o `fetch` não informa). */
function putWithProgress(url: string, blob: Blob, onBytes: (loaded: number, total: number) => void): Promise<{ status: number; body: unknown }> {
  const t = getT(sharedMessages, 'upload');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes(e.loaded, e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new UploadError(t('conexaoCaiu')));
    xhr.onabort = () => reject(new UploadError(t('cancelado')));
    xhr.send(blob);
  });
}

/**
 * Envio direto do navegador para o armazenamento: valida, comprime, pede o token à API
 * e manda o arquivo sem passar pela função (plano §2.4). Devolve a URL do arquivo.
 * Com a API real o destino é o Vercel Blob; com a simulada, o mock. A tela não muda.
 */
/**
 * API real (issue #73): o `@vercel/blob/client` pede o token em `/uploads/blob` e manda o arquivo direto para o
 * Blob; depois a API confirma (`/uploads/complete`) e devolve o endereço a guardar (privado para provas).
 */
async function uploadToBlob(blob: Blob, purpose: UploadPurpose, onPercent: (percent: number) => void): Promise<string> {
  const t = getT(sharedMessages, 'upload');
  const me = await api.get('/me', { schema: Me.nullable() });
  if (!me) throw new UploadError(t('entrarParaEnviar'));
  const { upload } = await import('@vercel/blob/client');
  try {
    const stored = await upload(`${purpose}/${me.id}/imagem.jpg`, blob, {
      access: isPrivateUpload(purpose) ? 'private' : 'public',
      handleUploadUrl: '/api/v1/uploads/blob',
      clientPayload: JSON.stringify({ purpose, contentType: 'image/jpeg', size: blob.size }),
      contentType: 'image/jpeg',
      onUploadProgress: ({ percentage }) => onPercent(percentage),
    });
    const file = await api.post('/uploads/complete', { url: stored.url, purpose }, { schema: UploadedFile });
    return file.url;
  } catch (error) {
    if (error instanceof ApiError || error instanceof UploadError) throw error;
    throw new UploadError(t('falhaConfiraConexao'));
  }
}

export async function uploadImage(file: File, purpose: UploadPurpose, opts: UploadImageOptions = {}): Promise<string> {
  const { onProgress, ...compression } = opts;
  let last = -1;
  const report = (phase: UploadProgress['phase'], percent: number) => {
    const value = Math.max(last, Math.min(100, Math.round(percent)));
    if (value === last) return;
    last = value;
    onProgress?.({ phase, percent: value });
  };

  const invalid = validateImage(file);
  if (invalid) throw new UploadError(invalid);
  report('preparing', 0);
  const blob = await compressImage(file, compression);
  report('preparing', 10);
  if (!isModuleMocked('uploads')) {
    const url = await uploadToBlob(blob, purpose, (p) => report('uploading', PREPARED + ((100 - PREPARED) * p) / 100));
    report('uploading', 100);
    return url;
  }
  const token = await api.post('/uploads/token', { purpose, contentType: 'image/jpeg', size: blob.size }, { schema: UploadToken });
  report('uploading', PREPARED);
  const res = await putWithProgress(token.uploadUrl, blob, (loaded, total) => report('uploading', PREPARED + ((100 - PREPARED) * loaded) / Math.max(1, total)));
  if (res.status < 200 || res.status >= 300) {
    const problem = res.body as { title?: string } | null;
    throw new ApiError({ type: 'about:blank', title: problem?.title ?? getT(sharedMessages, 'upload')('falha'), status: res.status });
  }
  const url = UploadResult.parse(res.body).url;
  report('uploading', 100);
  return url;
}

export function uploadErrorMessage(error: unknown): string {
  if (error instanceof UploadError || error instanceof ApiError) return error.message;
  return getT(sharedMessages, 'upload')('falhaTenteDeNovo');
}
