/**
 * Imagem do link compartilhado do campeonato (issue #77): nome, jogo, data e vagas, com a identidade Nova Green.
 * O gerador de imagem não lê variáveis CSS, então as cores dos tokens se repetem aqui.
 */
import { ImageResponse } from 'next/og';
import { getPublicTournament } from '@/shared/server/public-data';

export const alt = 'Campeonato na Nova Arena';
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
  const t = await getPublicTournament(slug).catch(() => null);
  const title = t?.name ?? 'Campeonato de eSports mobile';
  const subtitle = t ? `${t.gameIcon} ${t.gameName} · ${t.modeName}` : 'Free Fire · Clash Royale · 8 Ball Pool · eFootball';
  const details = t ? [t.startsAt ? `Começa ${dateFmt.format(new Date(t.startsAt))}` : null, `${t.takenSlots}/${t.maxParticipants} vagas`].filter(Boolean).join('  ·  ') : 'Inscreva-se, monte seu squad e acompanhe as partidas';

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: `linear-gradient(135deg, ${COLORS.ink} 0%, ${COLORS.deep} 100%)`, color: COLORS.text, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>
          <div style={{ width: 20, height: 20, borderRadius: 10, background: COLORS.glow }} />
          NOVA ARENA
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
