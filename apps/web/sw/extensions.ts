/**
 * Pontos de extensão do service worker.
 *
 * ## Notificações push (`push` e `notificationclick`)
 * A frente de notificações entrega os handlers num módulo próprio. Contrato esperado:
 *
 * ```ts
 * // apps/web/features/notifications/push/sw-handlers.ts (sugestão de caminho)
 * export function registerPushHandlers(sw: ServiceWorkerGlobalScope): void {
 *   sw.addEventListener('push', (event) => { ... event.waitUntil(sw.registration.showNotification(...)) });
 *   sw.addEventListener('notificationclick', (event) => { ... event.waitUntil(sw.clients.openWindow(url)) });
 * }
 * ```
 *
 * Regras para o módulo (ele roda dentro do worker, empacotado pelo esbuild do Serwist):
 * - só APIs de worker (sem `window`, `document`, React ou `next/*`);
 * - nada de dados sensíveis no payload do push: só título, corpo curto e o link relativo (`/c/...`, `/notificacoes`);
 * - o clique abre/foca uma aba já aberta antes de criar outra (`clients.matchAll` + `client.focus()`).
 *
 * O tratamento do push (issue 109) fica em `features/notifications/push/sw.ts`, sem DOM nem React.
 */
/// <reference lib="webworker" />

import { registerPushHandlers } from '../features/notifications/push/sw';

export function registerExtensions(sw: ServiceWorkerGlobalScope): void {
  registerPushHandlers(sw);
}
