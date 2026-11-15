/**
 * Tags de cache das páginas públicas (issue #77). As páginas renderizadas no servidor (`/c/[slug]`, `/u/[nick]`,
 * sitemap) guardam os dados com estas tags; a API avisa quando eles mudam e a próxima visita já vem atualizada.
 */
import type { AppContext } from './context';

export const TOURNAMENTS_TAG = 'tournaments';
export const userTag = (nicknameKey: string) => `user:${nicknameKey.toLowerCase()}`;

/** Campeonato mudou (dados, status, inscrições, comunicados): páginas de campeonato e sitemap. */
export function revalidateTournaments(c: AppContext): void {
  try {
    c.get('deps').revalidate([TOURNAMENTS_TAG]);
  } catch (error) {
    // Falha no cache não desfaz a ação: no pior caso a página atualiza no próximo ciclo.
    c.get('log').warn('não foi possível revalidar as páginas de campeonato', { error: String(error) });
  }
}

export function revalidateUser(c: AppContext, ...nicknameKeys: string[]): void {
  try {
    c.get('deps').revalidate(nicknameKeys.map(userTag));
  } catch (error) {
    c.get('log').warn('não foi possível revalidar o perfil', { error: String(error) });
  }
}
