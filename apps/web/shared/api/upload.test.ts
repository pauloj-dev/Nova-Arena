import { describe, expect, it } from 'vitest';
import { as, call, setupMockApi } from '@/mocks/testing';
import { fitWithin, validateImage } from './upload';

describe('validação de imagem antes do envio (RNF-09)', () => {
  it('aceita PNG, JPG e WebP de até 5 MB', () => {
    expect(validateImage({ type: 'image/png', size: 1024 })).toBeNull();
    expect(validateImage({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateImage({ type: 'image/webp', size: 10 })).toBeNull();
  });
  it('recusa o que não é imagem e o que passa de 5 MB', () => {
    expect(validateImage({ type: 'application/pdf', size: 10 })).toMatch(/PNG, JPG ou WebP/);
    expect(validateImage({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPG ou WebP/);
    expect(validateImage({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
  it('redimensiona mantendo a proporção e nunca aumenta', () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 4000, 1280)).toEqual({ width: 320, height: 1280 });
  });
});

describe('token de upload', () => {
  setupMockApi();

  it('exige login', async () => {
    as(null);
    expect((await call('POST', '/uploads/token', { purpose: 'evidence', contentType: 'image/png', size: 100 })).status).toBe(401);
  });
  it('é recusado para arquivo que não é imagem ou maior que 5 MB', async () => {
    as('u_bianca');
    expect((await call('POST', '/uploads/token', { purpose: 'evidence', contentType: 'application/pdf', size: 100 })).status).toBe(400);
    expect((await call('POST', '/uploads/token', { purpose: 'evidence', contentType: 'image/png', size: 6 * 1024 * 1024 })).status).toBe(400);
    expect((await call('POST', '/uploads/token', { purpose: 'evidence', contentType: 'image/png', size: 100 })).status).toBe(200);
  });
  it('o armazenamento recusa token de outra pessoa e arquivo maior que o autorizado', async () => {
    as('u_bianca');
    const { data } = await call<{ token: string }>('POST', '/uploads/token', { purpose: 'evidence', contentType: 'image/png', size: 4 });
    const put = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png') => fetch(`http://localhost:3000/api/v1/uploads/${data.token}`, { method: 'PUT', headers: { 'Content-Type': type }, body: new Blob([bytes]) });
    as('u_lucas');
    expect((await put(new Uint8Array([1, 2, 3]))).status).toBe(403);
    as('u_bianca');
    expect((await put(new Uint8Array(10))).status).toBe(400);
    expect((await put(new Uint8Array([1, 2, 3]), 'image/jpeg')).status).toBe(400);
    const ok = await put(new Uint8Array([1, 2, 3]));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toBe('data:image/png;base64,AQID');
    // Token de uso único.
    expect((await put(new Uint8Array([1, 2, 3]))).status).toBe(403);
  });
});
