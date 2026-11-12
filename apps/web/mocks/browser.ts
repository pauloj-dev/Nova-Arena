import { setupWorker } from '#msw-browser';
import { enabledHandlers } from './handlers';

let started: Promise<unknown> | null = null;

/** Liga o service worker da API simulada (uma vez só). */
export function startMockApi(): Promise<unknown> {
  if (!started) {
    const worker = setupWorker(...enabledHandlers());
    started = worker.start({
      // O que não for da API simulada (páginas, imagens, fontes) passa direto, sem aviso.
      onUnhandledFrame: 'bypass',
      quiet: true,
      serviceWorker: { url: '/mockServiceWorker.js' },
    });
  }
  return started;
}
