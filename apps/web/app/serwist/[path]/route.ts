/**
 * Serve o service worker do PWA (`/serwist/sw.js` e o mapa) — issue 105. O Serwist empacota `sw/sw.ts` com esbuild
 * no build e injeta a lista de pré-carregamento (os estáticos com hash do Next e os ícones). Nada de `/api` entra nela.
 */
import { randomUUID } from 'node:crypto';
import { createSerwistRoute } from '@serwist/turbopack';

const distDir = (process.env.NEXT_DIST_DIR ?? '.next').replace(/\/$/, '');
/** Versão da página offline no pré-carregamento: muda a cada deploy. */
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'sw/sw.ts',
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: '/sem-conexao', revision }],
  globPatterns: [`${distDir}/static/**/*.{js,css,woff2,svg,png,ico,webmanifest}`, 'public/icons/*.{png,svg}', 'public/brand/*.svg'],
  globIgnores: ['public/mockServiceWorker.js'],
  // Nenhum arquivo grande no pré-carregamento (o limite evita baixar mídia pesada na instalação).
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
});
