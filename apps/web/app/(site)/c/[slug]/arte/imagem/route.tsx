/**
 * Arte de resultado gerada no servidor (issue #89): `GET /c/:slug/arte/imagem?formato=paisagem|quadrada` devolve o PNG
 * da arte de campeões do campeonato encerrado — o mesmo layout de `/c/:slug/arte`. Sem pódio (campeonato em
 * andamento) = 404. O pódio não muda depois do encerramento, então a imagem fica no cache da CDN por um dia.
 */
import { appMessages } from '@/app/messages';
import { championsImage } from '@/features/artwork/og';
import type { ArtFormat } from '@/features/artwork/theme';
import { getT } from '@/shared/i18n/core';
import { getPublicPodium, getPublicTournament } from '@/shared/server/public-data';

const FORMATS: Record<string, ArtFormat> = { paisagem: 'landscape', landscape: 'landscape', quadrada: 'square', square: 'square' };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = getT(appMessages, 'ArteImagem');
  const format = FORMATS[new URL(request.url).searchParams.get('formato') ?? 'paisagem'];
  if (!format) return new Response(t('formatoInvalido'), { status: 400 });
  const tournament = await getPublicTournament(slug).catch(() => null);
  const podium = tournament && (tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED') ? await getPublicPodium(tournament.id).catch(() => null) : null;
  if (!tournament || !podium) return new Response(t('soEncerrado'), { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return championsImage(tournament, podium, format, { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' });
}
