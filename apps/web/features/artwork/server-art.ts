/**
 * Tema e dados da arte de resultado gerada no servidor (issue #89). O gerador de imagem (`next/og`) não lê variáveis
 * CSS, então os valores dos tokens "Nova Green" de `packages/ui/src/styles/tokens.css` se repetem aqui.
 */
import type { Podium, Tournament } from '@nova/schemas';
import type { ArtFormat, ArtTheme } from './theme';

/** Mesmos valores dos tokens de `tokens.css` (primary-900/700/600/100/500, white, gold-400, silver-300, bronze-600, gray-900). */
export const SERVER_THEME: ArtTheme = {
  bgFrom: '#065f46', // check-colors-ignore
  bgMid: '#15803d', // check-colors-ignore
  bgTo: '#16a34a', // check-colors-ignore
  text: '#ffffff', // check-colors-ignore
  textSoft: '#dcfce7', // check-colors-ignore
  brand: '#22c55e', // check-colors-ignore
  gold: '#facc15', // check-colors-ignore
  silver: '#cbd5e1', // check-colors-ignore
  bronze: '#d97706', // check-colors-ignore
  ink: '#0f172a', // check-colors-ignore
  fontDisplay: 'sans-serif',
  fontBody: 'sans-serif',
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Endereço mostrado no rodapé da arte (sem protocolo). */
export function siteLabelFor(slug: string, siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://novaarena.gg'): string {
  let host = 'novaarena.gg';
  try {
    host = new URL(siteUrl).host || host;
  } catch {
    // endereço inválido na configuração: fica o padrão.
  }
  return `${host}/c/${slug}`;
}

/** As propriedades da arte de campeões a partir do campeonato e do pódio. */
export function championsArtProps(t: Pick<Tournament, 'name' | 'slug' | 'gameName' | 'gameIcon'>, podium: Podium, format: ArtFormat) {
  return {
    tournamentName: t.name,
    gameName: t.gameName,
    gameIcon: t.gameIcon,
    dateLabel: dateFmt.format(new Date(podium.finishedAt)),
    places: podium.places.map((p) => ({ place: p.place, name: p.name, tag: p.tag })),
    siteLabel: siteLabelFor(t.slug),
    format,
    theme: SERVER_THEME,
  };
}

