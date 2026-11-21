/** Push no service worker (issue #109): o que aparece no aparelho e para onde o clique leva. */
import { describe, expect, it, vi } from 'vitest';
import { urlBase64ToUint8Array } from './client';
import { handleNotificationClick, handlePush, notificationFor, registerPushHandlers, targetPath, type PushScope } from './sw';

const ID = '11111111-1111-4111-8111-111111111111';
const payload = { id: ID, type: 'CHECKIN_OPEN', title: 'Check-in aberto', body: 'Sua partida começa em breve.', link: '/c/copa?aba=partidas' };

function scope(windows: { url: string; focus: () => Promise<unknown>; navigate?: (url: string) => Promise<unknown> }[] = []) {
  const listeners = new Map<string, (event: never) => void>();
  const s = {
    location: { origin: 'https://novaarena.gg' },
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => undefined) },
    addEventListener: (type: string, listener: (event: never) => void) => void listeners.set(type, listener),
  };
  return { s: s as unknown as PushScope & typeof s, listeners };
}

describe('push no service worker', () => {
  it('mostra o título e o texto da notificação, com o id como tag (repetição substitui, não duplica)', async () => {
    const { s } = scope();
    await handlePush(s, { data: { json: () => payload }, waitUntil: () => undefined });
    expect(s.registration.showNotification).toHaveBeenCalledWith('Check-in aberto', expect.objectContaining({ body: 'Sua partida começa em breve.', tag: ID, lang: 'pt-BR', data: { id: ID, link: '/c/copa?aba=partidas' } }));
  });

  it('payload fora do contrato ou ilegível: aviso genérico (o navegador exige mostrar algo)', async () => {
    const { s } = scope();
    await handlePush(s, {
      data: {
        json: () => {
          throw new Error('não é JSON');
        },
      },
      waitUntil: () => undefined,
    });
    expect(s.registration.showNotification).toHaveBeenCalledWith('Nova Arena', expect.objectContaining({ body: 'Você tem um aviso novo.' }));
    expect(notificationFor({ ...payload, type: 'NAO_EXISTE' })).toBeNull();
  });

  it('clique: foca a aba aberta do site e navega para o link; sem aba, abre uma', async () => {
    const tab = { url: 'https://novaarena.gg/', focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
    const { s } = scope([tab]);
    const close = vi.fn();
    await handleNotificationClick(s, { notification: { data: { link: '/c/copa?aba=partidas' }, close }, waitUntil: () => undefined });
    expect(close).toHaveBeenCalled();
    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).toHaveBeenCalledWith('https://novaarena.gg/c/copa?aba=partidas');

    const empty = scope();
    await handleNotificationClick(empty.s, { notification: { data: { link: 'https://golpe.example.com' }, close }, waitUntil: () => undefined });
    expect(empty.s.clients.openWindow).toHaveBeenCalledWith('https://novaarena.gg/notificacoes');
  });

  it('só abre caminhos do próprio site', () => {
    expect(targetPath('/minha-conta')).toBe('/minha-conta');
    expect(targetPath('//golpe.example.com')).toBe('/notificacoes');
    expect(targetPath(null)).toBe('/notificacoes');
  });

  it('registerPushHandlers liga os dois eventos com waitUntil', async () => {
    const { s, listeners } = scope();
    registerPushHandlers(s);
    expect([...listeners.keys()].sort()).toEqual(['notificationclick', 'push']);
    const waitUntil = vi.fn();
    (listeners.get('push') as unknown as (e: unknown) => void)({ data: { json: () => payload }, waitUntil });
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it('chave VAPID em base64url vira bytes', () => {
    expect([...urlBase64ToUint8Array('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });
});
