/**
 * Arte de resultado gerada no servidor (issue #89): `GET /c/:slug/arte/imagem?formato=paisagem|quadrada` devolve o PNG
 * da arte de campeões do campeonato encerrado — o mesmo layout de `/c/:slug/arte`. Sem pódio (campeonato em
 * andamento) = 404. O pódio não muda depois do encerramento, então a imagem fica no cache da CDN por um dia.
 */
import { championsImage } from '@/features/artwork/og';
import type { ArtFormat } from '@/features/artwork/theme';
import { getPublicPodium, getPublicTournament } from '@/shared/server/public-data';

const FORMATS: Record<string, ArtFormat> = { paisagem: 'landscape', landscape: 'landscape', quadrada: 'square', square: 'square' };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const format = FORMATS[new URL(request.url).searchParams.get('formato') ?? 'paisagem'];
  if (!format) return new Response('Formato inválido: use paisagem ou quadrada.', { status: 400 });
  const t = await getPublicTournament(slug).catch(() => null);
  const podium = t && (t.status === 'FINISHED' || t.status === 'ARCHIVED') ? await getPublicPodium(t.id).catch(() => null) : null;
  if (!t || !podium) return new Response('Arte disponível só para campeonato encerrado.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return championsImage(t, podium, format, { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' });
}
