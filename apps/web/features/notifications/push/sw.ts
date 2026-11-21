/**
 * Tratamento do push **dentro do service worker** do PWA (issue #109). Este módulo não registra nada sozinho:
 * o service worker do PWA (Serwist, issue #105) importa e liga, por exemplo em `app/sw.ts`:
 *
 * ```ts
 * import { registerPushHandlers } from '@/features/notifications/push/sw';
 * declare const self: ServiceWorkerGlobalScope;
 * registerPushHandlers(self);
 * ```
 *
 * - `push`: mostra a notificação do sistema com o mesmo título e texto do sino. A `tag` é o id da notificação:
 *   se a mesma mensagem chegar de novo (nova tentativa do servidor), ela substitui a anterior em vez de duplicar.
 * - `notificationclick`: foca uma aba do site já aberta (navegando para o link) ou abre uma nova. Só abre
 *   caminhos do próprio site.
 *
 * Sem dependência de DOM nem de React: tipos mínimos abaixo, para compilar no service worker e nos testes.
 */
import { PushPayload } from '@nova/schemas';

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
export interface PushEventLike extends ExtendableEventLike {
  data: { json(): unknown } | null;
}
export interface NotificationClickEventLike extends ExtendableEventLike {
  notification: { data?: unknown; close(): void };
}
interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}
export interface PushScope {
  location: { origin: string };
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> };
  clients: { matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>; openWindow(url: string): Promise<unknown> };
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: NotificationClickEventLike) => void): void;
}

const ICON = '/brand/nova-arena-simbolo-1024.png';
const FALLBACK_PATH = '/notificacoes';

/** Caminho do próprio site para abrir (link externo ou estranho cai na lista de notificações). */
export function targetPath(link: unknown): string {
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : FALLBACK_PATH;
}

/** O que mostrar para uma mensagem de push; `null` para payload fora do contrato (não mostra nada estranho). */
export function notificationFor(data: unknown): { title: string; options: Record<string, unknown> } | null {
  const parsed = PushPayload.safeParse(data);
  if (!parsed.success) return null;
  const n = parsed.data;
  return {
    title: n.title,
    options: { body: n.body, tag: n.id, icon: ICON, badge: ICON, lang: 'pt-BR', data: { id: n.id, link: targetPath(n.link) }, renotify: false },
  };
}

export async function handlePush(scope: PushScope, event: PushEventLike): Promise<void> {
  let data: unknown = null;
  try {
    data = event.data?.json() ?? null;
  } catch {
    data = null;
  }
  const shown = notificationFor(data);
  // Aviso genérico se o conteúdo não puder ser lido: os navegadores exigem mostrar algo a cada push.
  await scope.registration.showNotification(shown?.title ?? 'Nova Arena', shown?.options ?? { body: 'Você tem um aviso novo.', icon: ICON, data: { link: FALLBACK_PATH } });
}

export async function handleNotificationClick(scope: PushScope, event: NotificationClickEventLike): Promise<void> {
  event.notification.close();
  const link = targetPath((event.notification.data as { link?: unknown } | undefined)?.link);
  const url = new URL(link, scope.location.origin).href;
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((w) => w.url.startsWith(scope.location.origin));
  if (open) {
    await open.focus();
    if (open.navigate) await open.navigate(url);
    return;
  }
  await scope.clients.openWindow(url);
}

/** Liga os dois eventos no service worker. */
export function registerPushHandlers(scope: PushScope): void {
  scope.addEventListener('push', (event) => event.waitUntil(handlePush(scope, event)));
  scope.addEventListener('notificationclick', (event) => event.waitUntil(handleNotificationClick(scope, event)));
}
