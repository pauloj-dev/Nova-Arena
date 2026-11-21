import type { MetadataRoute } from 'next';
import { getT } from '@/shared/i18n/core';
import { appMessages } from './messages';

/**
 * Manifesto do PWA (issue 105, RNF-12): instalável no Android (Chrome/Edge) e no iOS (Safari, "Adicionar à Tela
 * de Início", que usa também o `app/apple-icon.png`). Ícones gerados por `scripts/brand-assets.mts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  const t = getT(appMessages, 'manifest');
  return {
    id: '/',
    name: t('nome'),
    short_name: t('nomeCurto'),
    description: t('descricao'),
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
      { name: t('atalhos.campeonatos'), short_name: t('atalhos.campeonatosCurto'), url: '/campeonatos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: t('atalhos.meusCampeonatos'), short_name: t('atalhos.meusCampeonatosCurto'), url: '/minha-conta/campeonatos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: t('atalhos.notificacoes'), short_name: t('atalhos.notificacoesCurto'), url: '/notificacoes', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
