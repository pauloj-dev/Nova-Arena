import { describe, expect, it } from 'vitest';
import {
  AVATAR_QUALITIES,
  AVATAR_SIZES,
  canPan,
  cropRect,
  dataUrlBytes,
  encodeWithinLimit,
  INITIAL_CROP,
  MAX_AVATAR_FILE_BYTES,
  nudgeCrop,
  panCrop,
  validateAvatarFile,
} from './avatarImage';

describe('validateAvatarFile', () => {
  it('aceita imagem de até 5 MB', () => {
    expect(validateAvatarFile({ type: 'image/png', size: 1024 })).toBeNull();
    expect(validateAvatarFile({ type: 'image/jpeg', size: MAX_AVATAR_FILE_BYTES })).toBeNull();
  });
  it('recusa o que não é imagem', () => {
    expect(validateAvatarFile({ type: 'application/pdf', size: 10 })).toMatch(/não é uma imagem/);
    expect(validateAvatarFile({ type: '', size: 10 })).toMatch(/não é uma imagem/);
  });
  it('recusa imagem acima de 5 MB', () => {
    expect(validateAvatarFile({ type: 'image/png', size: MAX_AVATAR_FILE_BYTES + 1 })).toMatch(/5 MB/);
  });
});

describe('cropRect', () => {
  it('sem zoom, pega o maior quadrado centralizado', () => {
    expect(cropRect(400, 200, INITIAL_CROP)).toEqual({ sx: 100, sy: 0, size: 200 });
    expect(cropRect(200, 400, INITIAL_CROP)).toEqual({ sx: 0, sy: 100, size: 200 });
  });
  it('com zoom 2, o quadrado tem metade do lado e continua no centro', () => {
    expect(cropRect(400, 400, { zoom: 2, offsetX: 0, offsetY: 0 })).toEqual({ sx: 100, sy: 100, size: 200 });
  });
  it('o deslocamento leva o quadrado até a borda, nunca além', () => {
    expect(cropRect(400, 200, { zoom: 1, offsetX: -1, offsetY: 0 })).toEqual({ sx: 0, sy: 0, size: 200 });
    expect(cropRect(400, 200, { zoom: 1, offsetX: 1, offsetY: 0 })).toEqual({ sx: 200, sy: 0, size: 200 });
    const far = cropRect(400, 200, { zoom: 1, offsetX: 9, offsetY: -9 });
    expect(far.sx + far.size).toBeLessThanOrEqual(400);
    expect(far.sy).toBe(0);
  });
  it('limita o zoom entre 1 e 3', () => {
    expect(cropRect(300, 300, { zoom: 0.2, offsetX: 0, offsetY: 0 }).size).toBe(300);
    expect(cropRect(300, 300, { zoom: 10, offsetX: 0, offsetY: 0 }).size).toBe(100);
  });
});

describe('mover a foto', () => {
  it('imagem quadrada sem zoom não tem para onde mover', () => {
    expect(canPan(300, 300, INITIAL_CROP)).toEqual({ x: false, y: false });
    expect(canPan(400, 200, INITIAL_CROP)).toEqual({ x: true, y: false });
    expect(canPan(300, 300, { zoom: 2, offsetX: 0, offsetY: 0 })).toEqual({ x: true, y: true });
  });
  it('arrastar a foto para a direita mostra o lado esquerdo da imagem', () => {
    const before = cropRect(400, 200, INITIAL_CROP);
    const after = cropRect(400, 200, panCrop(INITIAL_CROP, 50, 0, 200, 400, 200));
    // 50 px na prévia de 200 px, com quadrado de 200 px de origem = 50 px na imagem.
    expect(after.sx).toBeCloseTo(before.sx - 50);
    expect(after.sy).toBe(before.sy);
  });
  it('arrastar além da borda para na borda', () => {
    const after = cropRect(400, 200, panCrop(INITIAL_CROP, 5000, 5000, 200, 400, 200));
    expect(after.sx).toBe(0);
    expect(after.sy).toBe(0);
  });
  it('as setas movem um passo e respeitam os limites', () => {
    expect(nudgeCrop(INITIAL_CROP, 1, 0).offsetX).toBeCloseTo(-0.1);
    expect(nudgeCrop(INITIAL_CROP, 0, -1).offsetY).toBeCloseTo(0.1);
    expect(nudgeCrop({ zoom: 2, offsetX: -1, offsetY: 0 }, 1, 0).offsetX).toBe(-1);
  });
});

describe('dataUrlBytes', () => {
  it('calcula o tamanho do conteúdo em base64', () => {
    // "Nova" = 4 bytes → "Tm92YQ==".
    expect(dataUrlBytes('data:text/plain;base64,Tm92YQ==')).toBe(4);
    expect(dataUrlBytes('data:image/jpeg;base64,')).toBe(0);
  });
});

describe('encodeWithinLimit', () => {
  const fake = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`;

  it('fica com a melhor combinação quando ela já cabe', () => {
    const result = encodeWithinLimit(() => fake(1000), 200_000);
    expect(result).toMatchObject({ size: AVATAR_SIZES[0], quality: AVATAR_QUALITIES[0], fits: true });
  });
  it('baixa a qualidade e depois o lado até caber', () => {
    // Tamanho simulado proporcional à área e à qualidade.
    const encode = (size: number, quality: number) => fake(size * size * quality * 5);
    const result = encodeWithinLimit(encode, 200_000);
    expect(result.fits).toBe(true);
    expect(dataUrlBytes(result.dataUrl)).toBeLessThanOrEqual(200_000);
    // 256² × 5 × 0,6 = 196.608 bytes: a primeira combinação que cabe.
    expect(result).toMatchObject({ size: 256, quality: 0.6 });
  });
  it('se nada cabe, devolve a menor e avisa', () => {
    const result = encodeWithinLimit(() => fake(999_999), 200_000);
    expect(result).toMatchObject({ size: AVATAR_SIZES[AVATAR_SIZES.length - 1], quality: AVATAR_QUALITIES[AVATAR_QUALITIES.length - 1], fits: false });
  });
});
