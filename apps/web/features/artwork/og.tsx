/**
 * Arte de resultado gerada no servidor com `next/og` (issue #89): o mesmo `ChampionsArt` da tela (`/c/[slug]/arte`),
 * com o tema já resolvido — o gerador de imagem não lê variáveis CSS, então os valores dos tokens "Nova Green" de
 * `packages/ui/src/styles/tokens.css` se repetem aqui. Usada pela rota da imagem e pela imagem de compartilhamento
 * (Open Graph) do campeonato encerrado.
 */
import { ImageResponse } from 'next/og';
import type { Podium, Tournament } from '@nova/schemas';
import { ChampionsArt } from './ChampionsArt';
import { championsArtProps } from './server-art';
import { ART_SIZES, type ArtFormat } from './theme';

/** PNG da arte de campeões. O resultado é final (o campeonato encerrado não muda): pode ficar no cache da CDN. */
export function championsImage(t: Pick<Tournament, 'name' | 'slug' | 'gameName' | 'gameIcon'>, podium: Podium, format: ArtFormat, headers?: Record<string, string>): ImageResponse {
  const { width, height } = ART_SIZES[format];
  return new ImageResponse(<ChampionsArt {...championsArtProps(t, podium, format)} />, { width, height, ...(headers ? { headers } : {}) });
}
