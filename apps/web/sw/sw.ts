/**
 * Service worker do PWA (issue #105, RNF-12), montado com Serwist e servido em `/serwist/sw.js`
 * (`app/serwist/[path]/route.ts`). Escopo `/`.
 *
 * Regras:
 * - **Nunca** guarda respostas da API (`/api/*`): dados de campeonato, sessão e resultados vêm sempre da rede.
 *   A rota é registrada antes de qualquer outra, e o Serwist usa a primeira que casar.
 * - Estáticos com hash (`/_next/static`) ficam pré-carregados (precache); fontes e imagens, em cache com revalidação.
 * - Navegação sem rede cai na página `/sem-conexao` (pré-carregada).
 * - Versão nova: o worker novo espera (`skipWaiting: false`) até a pessoa tocar em "Atualizar" no aviso da tela
 *   (`shared/pwa/UpdateNotice.tsx`), que manda `SKIP_WAITING`. Assim ninguém perde um formulário no meio.
 *
 * Ponto de extensão para notificações push: ver `./extensions.ts`.
 */
/// <reference lib="webworker" />
import { defaultCache } from '@serwist/turbopack/worker';
import { NetworkOnly, Serwist, type PrecacheEntry, type RuntimeCaching, type SerwistGlobalConfig } from 'serwist';
import { registerExtensions } from './extensions';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Qualquer coisa da nossa API — nunca do cache. */
const apiNeverCached: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/api/'),
  handler: new NetworkOnly(),
};

/**
 * O `defaultCache` do Serwist guarda `/api/*` em "apis" (NetworkFirst): essa entrada sai, e a regra acima a substitui.
 * As demais (fontes, imagens, JS/CSS, páginas e RSC) ficam.
 */
const withoutApi = defaultCache.filter((entry) => !(entry.handler && 'cacheName' in entry.handler && (entry.handler as { cacheName?: string }).cacheName === 'apis'));

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [apiNeverCached, ...withoutApi],
  fallbacks: {
    entries: [
      {
        url: '/sem-conexao',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

registerExtensions(self);
serwist.addEventListeners();
