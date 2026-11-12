import type { CSSProperties } from 'react';
import { ART_SIZES, type ArtFormat, type ArtTheme } from './theme';

export interface ArtPlace {
  place: number;
  name: string;
  tag: string | null;
}

export interface ChampionsArtProps {
  tournamentName: string;
  gameName: string;
  gameIcon: string;
  /** Data do encerramento, já formatada ("12/11/2026"). */
  dateLabel: string;
  places: ArtPlace[];
  /** Endereço mostrado no rodapé (sem protocolo). */
  siteLabel: string;
  format: ArtFormat;
  theme: ArtTheme;
}

const PLACE_TITLE: Record<number, string> = { 1: 'CAMPEÃO', 2: '2º LUGAR', 3: '3º LUGAR' };

/** Cabeçalho comum das artes: marca à esquerda, jogo à direita. */
export function ArtHeader({ gameName, gameIcon, theme, scale }: { gameName: string; gameIcon: string; theme: ArtTheme; scale: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', fontFamily: theme.fontDisplay, fontSize: 30 * scale, fontWeight: 700, letterSpacing: 2 }}>
        <div style={{ display: 'flex', width: 18 * scale, height: 18 * scale, borderRadius: 999, backgroundColor: theme.brand, marginRight: 12 * scale }} />
        NOVA ARENA
      </div>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 24 * scale, fontWeight: 600, color: theme.textSoft }}>
        <div style={{ display: 'flex', marginRight: 10 * scale, fontSize: 30 * scale }}>{gameIcon}</div>
        {gameName}
      </div>
    </div>
  );
}

export function artRootStyle(format: ArtFormat, theme: ArtTheme): CSSProperties {
  const { width, height } = ART_SIZES[format];
  return {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    width,
    height,
    padding: format === 'square' ? 72 : 56,
    boxSizing: 'border-box',
    backgroundImage: `linear-gradient(135deg, ${theme.bgFrom} 0%, ${theme.bgMid} 55%, ${theme.bgTo} 100%)`,
    color: theme.text,
    fontFamily: theme.fontBody,
    lineHeight: 1.2,
  };
}

/**
 * Arte de campeões (ORG-12): campeão, 2º e 3º, jogo, nome do campeonato e data, com a identidade
 * Nova Green. Só flexbox e estilos em linha, sem imagem externa: é o que o `next/og` aceita.
 */
export function ChampionsArt({ tournamentName, gameName, gameIcon, dateLabel, places, siteLabel, format, theme }: ChampionsArtProps) {
  const square = format === 'square';
  const scale = square ? 1.25 : 1;
  const sorted = [...places].sort((a, b) => a.place - b.place);
  const champion = sorted.find((p) => p.place === 1);
  const others = sorted.filter((p) => p.place !== 1);
  const medal = (place: number) => (place === 2 ? theme.silver : theme.bronze);

  return (
    <div style={artRootStyle(format, theme)}>
      <ArtHeader gameName={gameName} gameIcon={gameIcon} theme={theme} scale={scale} />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 22 * scale, fontWeight: 600, letterSpacing: 3, color: theme.textSoft }}>RESULTADO FINAL · {dateLabel}</div>
        <div style={{ display: 'flex', marginTop: 8 * scale, fontFamily: theme.fontDisplay, fontSize: (tournamentName.length > 28 ? 48 : 60) * scale, fontWeight: 700 }}>{tournamentName}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: square ? 'column' : 'row', alignItems: 'stretch' }}>
        {champion && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flexGrow: 1,
              flexBasis: 0,
              padding: 28 * scale,
              borderRadius: 20,
              backgroundColor: theme.gold,
              color: theme.ink,
              marginRight: square ? 0 : 24,
              marginBottom: square ? 24 : 0,
            }}
          >
            <div style={{ display: 'flex', fontSize: 22 * scale, fontWeight: 700, letterSpacing: 3 }}>🏆 {PLACE_TITLE[1]}</div>
            <div style={{ display: 'flex', marginTop: 6 * scale, fontFamily: theme.fontDisplay, fontSize: (champion.name.length > 18 ? 46 : 58) * scale, fontWeight: 700 }}>{champion.name}</div>
            {champion.tag && <div style={{ display: 'flex', fontSize: 22 * scale, fontWeight: 600 }}>[{champion.tag}]</div>}
          </div>
        )}
        {others.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1, flexBasis: 0 }}>
            {others.map((p, i) => (
              <div key={p.place} style={{ display: 'flex', alignItems: 'center', padding: 18 * scale, borderRadius: 16, borderWidth: 2, borderStyle: 'solid', borderColor: medal(p.place), marginTop: i === 0 ? 0 : 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 54 * scale, height: 54 * scale, borderRadius: 999, backgroundColor: medal(p.place), color: theme.ink, fontSize: 26 * scale, fontWeight: 700, marginRight: 16 * scale }}>{p.place}º</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', fontSize: 16 * scale, fontWeight: 600, letterSpacing: 2, color: theme.textSoft }}>{PLACE_TITLE[p.place] ?? `${p.place}º LUGAR`}</div>
                  <div style={{ display: 'flex', fontFamily: theme.fontDisplay, fontSize: 32 * scale, fontWeight: 700 }}>{p.name}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20 * scale, color: theme.textSoft }}>
        <div style={{ display: 'flex' }}>{siteLabel}</div>
        <div style={{ display: 'flex' }}>Campeonatos de eSports mobile</div>
      </div>
    </div>
  );
}
