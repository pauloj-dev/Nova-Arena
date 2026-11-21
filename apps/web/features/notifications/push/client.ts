/**
 * Push no PWA, lado do navegador (issue #109): pedir a permissão, assinar no service worker do site e mandar a
 * assinatura para a API (`POST /me/push-subscriptions`). O envio sai do mesmo `notify()` das notificações.
 *
 * Limitações conhecidas (documentadas em `docs/notificacoes.md`):
 * - iPhone e iPad (iOS/iPadOS 16.4+): só funciona com o site **instalado na tela de início**; no Safari aberto
 *   como página, `PushManager` não existe e o convite nem aparece.
 * - Sem service worker registrado (o do PWA entra com a issue #105), não há onde receber: devolve `unsupported`.
 * - Permissão negada no navegador só volta pelas configurações do site; o convite não insiste.
 */
import { Ok, PushPublicKey } from '@nova/schemas';
import { api } from '@/shared/api/client';

export type PushOutcome = 'subscribed' | 'denied' | 'unsupported';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Chave VAPID em base64url → bytes, como o `pushManager.subscribe` espera. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** O service worker do site, se houver (sem esperar para sempre por um que nunca vai registrar). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))]);
}

/** Pede a permissão (precisa vir de um clique) e assina. */
export async function subscribeToPush(): Promise<PushOutcome> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const { publicKey } = await api.get('/push/public-key', { schema: PushPublicKey });
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const json = subscription.toJSON();
  await api.post('/me/push-subscriptions', { endpoint: json.endpoint, keys: json.keys }, { schema: Ok });
  return 'subscribed';
}

/** Cancela a assinatura deste aparelho (no navegador e na API). */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await api.delete<void>('/me/push-subscriptions', { query: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
