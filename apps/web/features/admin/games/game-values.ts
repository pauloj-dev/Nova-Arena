/** Partes puras do formulário de jogo: slug, valores iniciais, limpeza antes de enviar e validação da capa. */
import type { Game, GameAdminInput, MatchType } from '@nova/schemas';
import type { z } from 'zod';

/** O que o formulário guarda (antes dos valores padrão do schema). */
export type GameFormValues = z.input<typeof GameAdminInput>;

/** "Free Fire MAX" → "free-fire-max". Mesmo formato que o `Slug` de `@nova/schemas` aceita. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export const DEFAULT_LOBBY_SIZE = 12;

export function emptyMode(matchType: MatchType = 'BATTLE_ROYALE'): GameFormValues['modes'][number] {
  return { name: '', teamSize: 1, maxSubs: 0, matchType, maxLobbySize: matchType === 'BATTLE_ROYALE' ? DEFAULT_LOBBY_SIZE : null };
}

export function emptyGame(): GameFormValues {
  return { name: '', slug: '', icon: '', coverUrl: null, platform: 'Mobile', active: true, requiredAccountFields: [], extraStatFields: [], modes: [emptyMode()] };
}

export function gameToForm(game: Game): GameFormValues {
  return {
    name: game.name,
    slug: game.slug,
    icon: game.icon,
    coverUrl: game.coverUrl,
    platform: game.platform,
    active: game.active,
    requiredAccountFields: game.requiredAccountFields.map((f) => ({ key: f.key, label: f.label, placeholder: f.placeholder ?? '', pattern: f.pattern ?? '' })),
    extraStatFields: game.extraStatFields.map((f) => ({ key: f.key, label: f.label, when: f.when })),
    modes: game.modes.map((m) => ({ id: m.id, name: m.name, teamSize: m.teamSize, maxSubs: m.maxSubs, matchType: m.matchType, maxLobbySize: m.maxLobbySize })),
  };
}

/** Tira espaços sobrando, campos opcionais vazios e a sala máxima de modos que não são Battle Royale. */
export function cleanGameInput(values: GameAdminInput): GameAdminInput {
  return {
    ...values,
    name: values.name.trim(),
    icon: values.icon.trim(),
    platform: values.platform.trim(),
    requiredAccountFields: values.requiredAccountFields.map((f) => {
      const placeholder = f.placeholder?.trim();
      const pattern = f.pattern?.trim();
      return { key: f.key, label: f.label.trim(), ...(placeholder ? { placeholder } : {}), ...(pattern ? { pattern } : {}) };
    }),
    extraStatFields: values.extraStatFields.map((f) => ({ ...f, label: f.label.trim() })),
    modes: values.modes.map((m) => ({ ...m, name: m.name.trim(), maxLobbySize: m.matchType === 'BATTLE_ROYALE' ? m.maxLobbySize : null })),
  };
}

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Mensagem de erro da capa, ou `null` se o arquivo serve: precisa ser imagem e ter até 5 MB. */
export function coverFileError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!file.type.startsWith('image/')) return 'Escolha um arquivo de imagem (PNG, JPG ou WebP).';
  if (file.size > MAX_COVER_BYTES) return 'A imagem passa de 5 MB. Escolha uma menor.';
  return null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

const COVER_MAX_WIDTH = 1280;

/**
 * Upload simulado: a capa vira data URL. Antes, a imagem é reduzida para até 1280 px de largura,
 * porque o protótipo guarda tudo no `localStorage` e uma foto de 5 MB não caberia lá.
 */
export async function coverToDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Imagem inválida'));
      image.src = original;
    });
    const scale = Math.min(1, COVER_MAX_WIDTH / image.naturalWidth);
    if (scale === 1 && file.size <= 300 * 1024) return original;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return original;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    throw new Error('Não foi possível ler esta imagem. Tente outro arquivo.');
  }
}
