/**
 * Imagem do link compartilhado do campeonato (issue #77): nome, jogo, data e vagas, com a identidade Nova Green.
 * Campeonato encerrado (com pódio) usa a arte de campeões (issue #89), a mesma de `/c/[slug]/arte`.
 * O gerador de imagem não lê variáveis CSS, então as cores dos tokens se repetem aqui.
 */
import { ImageResponse } from 'next/og';
import { appMessages } from '@/app/messages';
import { championsImage } from '@/features/artwork/og';
import { getT } from '@/shared/i18n/core';
import { getPublicPodium, getPublicTournament } from '@/shared/server/public-data';

// O Next lê o `alt` como constante do módulo (não há função para ele).
export const alt = getT(appMessages, 'ImagemDoCampeonato')('alt');
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Mesmos valores de tokens.css (--brand-glow, --brand-deep, --brand-ink e o texto claro do tema escuro).
const COLORS = {
  glow: '#0af24a', // check-colors-ignore
  deep: '#067a2b', // check-colors-ignore
  ink: '#03201a', // check-colors-ignore
  text: '#ecfdf5', // check-colors-ignore
  muted: '#a7f3d0', // check-colors-ignore
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = await getPublicTournament(slug).catch(() => null);
  if (tournament && (tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED')) {
    const podium = await getPublicPodium(tournament.id).catch(() => null);
    if (podium && podium.places.length > 0) return championsImage(tournament, podium, 'landscape');
  }
  const t = getT(appMessages, 'ImagemDoCampeonato');
  const title = tournament?.name ?? t('tituloPadrao');
  const subtitle = tournament ? `${tournament.gameIcon} ${tournament.gameName} · ${tournament.modeName}` : t('subtituloPadrao');
  const details = tournament
    ? [tournament.startsAt ? t('comeca', { data: dateFmt.format(new Date(tournament.startsAt)) }) : null, t('vagas', { ocupadas: String(tournament.takenSlots), total: String(tournament.maxParticipants) })].filter(Boolean).join('  ·  ')
    : t('detalhesPadrao');

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: `linear-gradient(135deg, ${COLORS.ink} 0%, ${COLORS.deep} 100%)`, color: COLORS.text, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>
          <div style={{ width: 20, height: 20, borderRadius: 10, background: COLORS.glow }} />
          {t('marca')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 34, color: COLORS.muted }}>{subtitle}</div>
          <div style={{ fontSize: title.length > 40 ? 64 : 80, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 32, color: COLORS.muted }}>{details}</div>
      </div>
    ),
    size,
  );
}
