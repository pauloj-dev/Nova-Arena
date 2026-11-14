/** Renovação da sessão com a API real (issue #70): token de acesso vencido → refresh uma vez → repete. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { toMe } from '@/mocks/views';
import { api, renewSession } from './client';

const bianca = buildSeed().users.find((u) => u.id === 'u_bianca');
if (!bianca) throw new Error('seed sem a Bianca');
const me = toMe(bianca);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('renovação da sessão', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_MOCK', 'none');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('401 numa rota comum: renova e repete a chamada uma vez', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { type: 'about:blank', title: 'Entre', status: 401 }))
      .mockResolvedValueOnce(json(200, me))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api.get('/me/oauth')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/v1/me/oauth', '/api/v1/auth/refresh', '/api/v1/me/oauth']);
  });

  it('refresh recusado: devolve o 401 original, sem laço', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { type: 'about:blank', title: 'Entre na sua conta para continuar.', status: 401 })).mockResolvedValueOnce(json(401, {}));
    await expect(api.get('/me/oauth')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('várias telas ao mesmo tempo: um único refresh', async () => {
    fetchMock.mockImplementation(async () => json(200, me));
    await Promise.all([renewSession(), renewSession(), renewSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('com a API simulada não tenta renovar', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_MOCK', 'all');
    await expect(renewSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
