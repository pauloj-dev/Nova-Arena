/**
 * Lógica pura do avatar com recorte: validação do arquivo, cálculo do quadrado de recorte
 * a partir de zoom e deslocamento, e escolha de tamanho/qualidade até a imagem caber no limite.
 * Nada aqui toca em DOM ou canvas, para poder ser testado sozinho.
 */

/** Tamanho máximo do arquivo escolhido (antes do recorte). */
export const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;
/** Tamanho máximo da imagem recortada que vai para a API (data URL). */
export const MAX_AVATAR_BYTES = 200 * 1024;
/** Lados (px) tentados, do maior para o menor. */
export const AVATAR_SIZES = [256, 192, 128] as const;
/** Qualidades JPEG tentadas em cada lado, da melhor para a pior. */
export const AVATAR_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5] as const;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/** Mensagem de erro para a pessoa, ou `null` se o arquivo serve. */
export function validateAvatarFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'Este arquivo não é uma imagem. Escolha uma foto em JPG, PNG ou WebP.';
  if (file.size > MAX_AVATAR_FILE_BYTES) return 'A imagem tem mais de 5 MB. Escolha uma foto menor.';
  return null;
}

export interface CropState {
  /** 1 = o maior quadrado que cabe na imagem; 3 = três vezes mais perto. */
  zoom: number;
  /** Deslocamento do quadrado, de -1 (encostado à esquerda/no topo) a 1 (à direita/embaixo). 0 = centro. */
  offsetX: number;
  offsetY: number;
}

export const INITIAL_CROP: CropState = { zoom: 1, offsetX: 0, offsetY: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampCrop(crop: CropState): CropState {
  return { zoom: clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM), offsetX: clamp(crop.offsetX, -1, 1), offsetY: clamp(crop.offsetY, -1, 1) };
}

export interface CropRect {
  /** Canto superior esquerdo do quadrado, em pixels da imagem original. */
  sx: number;
  sy: number;
  /** Lado do quadrado, em pixels da imagem original. */
  size: number;
}

/** Quadrado da imagem original que entra no avatar. Nunca sai dos limites da imagem. */
export function cropRect(imageWidth: number, imageHeight: number, crop: CropState): CropRect {
  const c = clampCrop(crop);
  const size = Math.min(imageWidth, imageHeight) / c.zoom;
  const travelX = (imageWidth - size) / 2;
  const travelY = (imageHeight - size) / 2;
  return { sx: travelX * (1 + c.offsetX), sy: travelY * (1 + c.offsetY), size };
}

/** Em quais eixos ainda dá para mover a foto (não dá quando o quadrado já ocupa o eixo inteiro). */
export function canPan(imageWidth: number, imageHeight: number, crop: CropState): { x: boolean; y: boolean } {
  const { size } = cropRect(imageWidth, imageHeight, crop);
  return { x: imageWidth - size > 0.5, y: imageHeight - size > 0.5 };
}

/**
 * Arrastar a foto `dxPx`/`dyPx` pixels na prévia (de lado `previewPx`).
 * Puxar a foto para a direita mostra o que estava à esquerda: o quadrado anda no sentido contrário.
 */
export function panCrop(crop: CropState, dxPx: number, dyPx: number, previewPx: number, imageWidth: number, imageHeight: number): CropState {
  const c = clampCrop(crop);
  if (previewPx <= 0) return c;
  const { size } = cropRect(imageWidth, imageHeight, c);
  const scale = size / previewPx;
  const travelX = (imageWidth - size) / 2;
  const travelY = (imageHeight - size) / 2;
  return clampCrop({
    zoom: c.zoom,
    offsetX: travelX > 0 ? c.offsetX - (dxPx * scale) / travelX : 0,
    offsetY: travelY > 0 ? c.offsetY - (dyPx * scale) / travelY : 0,
  });
}

/** Alternativa por teclado ao arrastar: move a foto um passo (`dirX`/`dirY` = -1, 0 ou 1; 1 = foto para a direita/para baixo). */
export function nudgeCrop(crop: CropState, dirX: number, dirY: number, step = 0.1): CropState {
  const c = clampCrop(crop);
  return clampCrop({ zoom: c.zoom, offsetX: c.offsetX - dirX * step, offsetY: c.offsetY - dirY * step });
}

/** Tamanho em bytes do conteúdo de um data URL em base64. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export interface EncodedAvatar {
  dataUrl: string;
  size: number;
  quality: number;
  /** Falso se nem a menor combinação coube no limite (devolve a menor mesmo assim). */
  fits: boolean;
}

/**
 * Tenta lados e qualidades, do melhor para o pior, até a imagem caber em `maxBytes`.
 * `encode(size, quality)` desenha e devolve o data URL (no navegador, via `<canvas>`).
 */
export function encodeWithinLimit(encode: (size: number, quality: number) => string, maxBytes: number = MAX_AVATAR_BYTES): EncodedAvatar {
  let last: EncodedAvatar | null = null;
  for (const size of AVATAR_SIZES) {
    for (const quality of AVATAR_QUALITIES) {
      const dataUrl = encode(size, quality);
      const fits = dataUrlBytes(dataUrl) <= maxBytes;
      last = { dataUrl, size, quality, fits };
      if (fits) return last;
    }
  }
  return last as EncodedAvatar;
}
