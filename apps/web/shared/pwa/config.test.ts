import { describe, expect, it } from 'vitest';
import { isPwaEnabled } from './config';

describe('isPwaEnabled', () => {
  it('só registra o service worker em produção sem API simulada', () => {
    expect(isPwaEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCK: 'none' })).toBe(true);
    expect(isPwaEnabled({ NODE_ENV: 'production' })).toBe(true); // padrão de produção: API real
    expect(isPwaEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCK: 'auth,games' })).toBe(true); // builds de produção nunca usam mocks
    expect(isPwaEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_API_MOCK: 'none' })).toBe(false);
  });

  it('NEXT_PUBLIC_PWA força ligado ou desligado', () => {
    expect(isPwaEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCK: 'none', NEXT_PUBLIC_PWA: 'off' })).toBe(false);
    expect(isPwaEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_PWA: 'on' })).toBe(true);
  });
});
