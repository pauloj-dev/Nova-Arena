import { describe, expect, it } from 'vitest';
import { MAX_BANNER_BYTES, validateBannerFile } from './banner';

describe('validateBannerFile', () => {
  it('aceita PNG, JPG e WebP de até 5 MB', () => {
    expect(validateBannerFile({ type: 'image/png', size: 200_000 })).toBeNull();
    expect(validateBannerFile({ type: 'image/jpeg', size: MAX_BANNER_BYTES })).toBeNull();
    expect(validateBannerFile({ type: 'image/webp', size: 1 })).toBeNull();
  });

  it('recusa o que não é imagem (inclusive SVG e PDF)', () => {
    expect(validateBannerFile({ type: 'application/pdf', size: 100 })).toBe('Escolha uma imagem PNG, JPG ou WebP.');
    expect(validateBannerFile({ type: 'image/svg+xml', size: 100 })).toBe('Escolha uma imagem PNG, JPG ou WebP.');
    expect(validateBannerFile({ type: '', size: 100 })).not.toBeNull();
  });

  it('recusa imagem acima de 5 MB dizendo o tamanho', () => {
    expect(validateBannerFile({ type: 'image/png', size: MAX_BANNER_BYTES + 1 })).toContain('O máximo é 5 MB');
    expect(validateBannerFile({ type: 'image/png', size: 7.5 * 1024 * 1024 })).toContain('7,5 MB');
  });

  it('recusa arquivo vazio', () => {
    expect(validateBannerFile({ type: 'image/png', size: 0 })).toBe('O arquivo está vazio.');
  });
});
