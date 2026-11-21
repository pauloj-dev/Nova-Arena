/** Banner do campeonato: validação do arquivo (pura) e conversão para data URL (upload simulado do protótipo). */
import { getT } from '@/shared/i18n/core';
import { messages } from '../messages';

export const MAX_BANNER_BYTES = 5 * 1024 * 1024;
export const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const BANNER_MAX_WIDTH = 1600;

/** Mensagem de erro para o arquivo escolhido, ou nulo se ele serve. */
export function validateBannerFile(file: { type: string; size: number }): string | null {
  const t = getT(messages, 'banner');
  if (!BANNER_TYPES.includes(file.type)) return t('tipoInvalido');
  if (file.size > MAX_BANNER_BYTES) return t('muitoGrande', { tamanho: (file.size / (1024 * 1024)).toFixed(1).replace('.', ',') });
  if (file.size === 0) return t('vazio');
  return null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(getT(messages, 'banner')('naoLeu')));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(getT(messages, 'banner')('naoImagem')));
    img.src = src;
  });
}

/**
 * Lê a imagem, confere que ela abre de verdade (o tipo do arquivo pode mentir) e reduz para
 * no máximo 1.600 px de largura: o protótipo guarda tudo no navegador, onde o espaço é curto.
 * Em B1 isso vira upload direto para o armazenamento.
 */
export async function fileToBannerDataUrl(file: File): Promise<string> {
  const problem = validateBannerFile(file);
  if (problem) throw new Error(problem);
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, BANNER_MAX_WIDTH / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return original;
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const reduced = canvas.toDataURL('image/webp', 0.82);
  return reduced.startsWith('data:image/webp') ? reduced : canvas.toDataURL('image/jpeg', 0.85);
}
