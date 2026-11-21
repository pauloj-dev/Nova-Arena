import type { MetadataRoute } from 'next';

/**
 * Manifesto do PWA (issue 105, RNF-12): instalável no Android (Chrome/Edge) e no iOS (Safari, "Adicionar à Tela
 * de Início", que usa também o `app/apple-icon.png`). Ícones gerados por `scripts/brand-assets.mts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Nova Arena — campeonatos de eSports mobile',
    short_name: 'Nova Arena',
    description: 'Crie, organize e acompanhe campeonatos de Free Fire, Clash Royale, 8 Ball Pool, eFootball e outros jogos.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    // O manifesto não aceita variável CSS: repete o `--bg` do tema claro e a tinta da marca (tokens.css).
    // check-colors-ignore
    background_color: '#f8faf9',
    // check-colors-ignore
    theme_color: '#03201a',
    categories: ['games', 'sports', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Campeonatos', short_name: 'Campeonatos', url: '/campeonatos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Meus campeonatos', short_name: 'Meus', url: '/minha-conta/campeonatos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Notificações', short_name: 'Avisos', url: '/notificacoes', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
