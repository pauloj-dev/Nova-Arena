/**
 * `sitemap.xml` (issue #77): páginas públicas fixas e os campeonatos públicos (sem rascunho nem arquivado).
 * Atualizado junto com os campeonatos (mesma tag de cache).
 */
import type { MetadataRoute } from 'next';
import { listPublicTournaments } from '@/shared/server/public-data';
import { SITE_URL } from '@/shared/server/seo';

const STATIC_PAGES = ['', '/campeonatos', '/jogos', '/ranking', '/termos', '/privacidade'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tournaments = await listPublicTournaments().catch(() => []);
  return [
    ...STATIC_PAGES.map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: 'daily' as const, priority: path === '' ? 1 : 0.6 })),
    ...tournaments.map((t) => ({ url: `${SITE_URL}/c/${t.slug}`, lastModified: t.updatedAt, changeFrequency: 'hourly' as const, priority: 0.8 })),
  ];
}
