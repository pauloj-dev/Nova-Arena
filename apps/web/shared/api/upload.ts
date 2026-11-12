import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, UploadResult, UploadToken } from '@nova/schemas';
import { api, ApiError } from './client';

export type UploadPurpose = 'evidence' | 'avatar' | 'team-logo' | 'banner' | 'game-cover' | 'report';

export class UploadError extends Error {}

/** Confere tipo e tamanho antes de qualquer envio (RNF-09). Devolve a mensagem de erro ou nulo. */
export function validateImage(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) return 'Envie uma imagem PNG, JPG ou WebP.';
  if (file.size > UPLOAD_MAX_BYTES) return 'A imagem pode ter no máximo 5 MB.';
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
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadError('Não foi possível preparar a imagem neste navegador.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new UploadError('Não foi possível comprimir a imagem.');
  return blob;
}

/**
 * Envio direto do navegador para o armazenamento: valida, comprime, pede o token à API
 * e manda o arquivo sem passar pela função (plano §2.4). Devolve a URL do arquivo.
 * Na produção o destino é o Vercel Blob; a tela não muda.
 */
export async function uploadImage(file: File, purpose: UploadPurpose, opts: { maxSide?: number; quality?: number } = {}): Promise<string> {
  const invalid = validateImage(file);
  if (invalid) throw new UploadError(invalid);
  const blob = await compressImage(file, opts);
  const token = await api.post('/uploads/token', { purpose, contentType: 'image/jpeg', size: blob.size }, { schema: UploadToken });
  const res = await fetch(token.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { title?: string; status?: number } | null;
    throw new ApiError({ type: 'about:blank', title: problem?.title ?? 'Não foi possível enviar a imagem.', status: res.status });
  }
  return UploadResult.parse(await res.json()).url;
}

export function uploadErrorMessage(error: unknown): string {
  if (error instanceof UploadError || error instanceof ApiError) return error.message;
  return 'Não foi possível enviar a imagem. Tente de novo.';
}
