/** No servidor não existe service worker: este módulo substitui `msw/browser` fora do navegador. */
export function setupWorker(): never {
  throw new Error('A API simulada só roda no navegador.');
}
