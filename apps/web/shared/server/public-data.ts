/**
 * Dados públicos lidos no servidor (issue #77): páginas de campeonato e de perfil, metadados, imagem de
 * compartilhamento e sitemap. Chamam a API no próprio processo (sem ida pela rede) e guardam o resultado com
 * tags; a API revalida as tags quando os dados mudam.
 *
 * Com a API simulada (protótipo), o servidor não tem de onde ler: as funções devolvem `null` e a página
 * continua carregando no navegador, como antes.
 */
import 'server-only';
import { createApp, TOURNAMENTS_TAG, userTag, type App } from '@nova/api';
import { page, PublicUser, Tournament, TournamentSummary, type TournamentSummary as Summary } from '@nova/schemas';
import { unstable_cache } from 'next/cache';
import type { ZodType } from 'zod';
import { isModuleMocked } from '@/shared/api/mode';

let app: App | undefined;
const api = () => (app ??= createApp());

/** Uma revalidação de segurança, caso algum aviso da API se perca. */
const FALLBACK_SECONDS = 300;

async function getJson<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  const res = await api().request(`/api/v1${path}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API respondeu ${res.status} em ${path}`);
  const parsed = schema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

export async function getPublicTournament(slug: string): Promise<Tournament | null> {
  if (isModuleMocked('tournaments')) return null;
  return unstable_cache(() => getJson(`/tournaments/${encodeURIComponent(slug)}`, Tournament), ['public-tournament', slug], { tags: [TOURNAMENTS_TAG], revalidate: FALLBACK_SECONDS })();
}

export async function getPublicProfile(nickname: string): Promise<PublicUser | null> {
  if (isModuleMocked('users')) return null;
  const key = nickname.toLowerCase();
  return unstable_cache(() => getJson(`/users/${encodeURIComponent(key)}`, PublicUser), ['public-profile', key], { tags: [userTag(key)], revalidate: FALLBACK_SECONDS })();
}

/** Campeonatos públicos para o sitemap (até 1.000, os mais relevantes primeiro). */
export async function listPublicTournaments(): Promise<Summary[]> {
  if (isModuleMocked('tournaments')) return [];
  return unstable_cache(
    async () => {
      const items: Summary[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `?limit=50&cursor=${cursor}` : '?limit=50';
        const result = await getJson(`/tournaments${query}`, page(TournamentSummary));
        if (!result) break;
        items.push(...result.items);
        cursor = result.nextCursor;
      } while (cursor && items.length < 1000);
      return items;
    },
    ['public-tournament-list'],
    { tags: [TOURNAMENTS_TAG], revalidate: FALLBACK_SECONDS },
  )();
}
