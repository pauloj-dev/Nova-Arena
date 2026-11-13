import { ArtHeader, artRootStyle } from './ChampionsArt';
import type { ArtFormat, ArtTheme } from './theme';

export interface CertificateArtProps {
  participantName: string;
  /** Colocação no pódio (1 a 3) ou nulo para quem participou sem pódio. */
  place: number | null;
  tournamentName: string;
  gameName: string;
  gameIcon: string;
  dateLabel: string;
  organizerName: string;
  siteLabel: string;
  format: ArtFormat;
  theme: ArtTheme;
}

export function certificateTitle(place: number | null): string {
  if (place === 1) return 'Certificado de campeão';
  if (place === 2) return 'Certificado de vice-campeão';
  if (place === 3) return 'Certificado de 3º lugar';
  return 'Certificado de participação';
}

export function certificateSentence(place: number | null): string {
  if (place === 1) return 'conquistou o título de';
  if (place === 2) return 'ficou em 2º lugar em';
  if (place === 3) return 'ficou em 3º lugar em';
  return 'participou de';
}

/** Certificado por participante, com o mesmo cabeçalho e as mesmas restrições da arte de campeões (só flexbox). */
export function CertificateArt({ participantName, place, tournamentName, gameName, gameIcon, dateLabel, organizerName, siteLabel, format, theme }: CertificateArtProps) {
  const scale = format === 'square' ? 1.25 : 1;
  const accent = place === 1 ? theme.gold : place === 2 ? theme.silver : place === 3 ? theme.bronze : theme.textSoft;
  return (
    <div style={artRootStyle(format, theme)}>
      <ArtHeader gameName={gameName} gameIcon={gameIcon} theme={theme} scale={scale} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ display: 'flex', fontSize: 22 * scale, fontWeight: 700, letterSpacing: 4, color: accent }}>{certificateTitle(place).toUpperCase()}</div>
        <div style={{ display: 'flex', marginTop: 20 * scale, fontFamily: theme.fontDisplay, fontSize: (participantName.length > 20 ? 56 : 72) * scale, fontWeight: 700 }}>{participantName}</div>
        <div style={{ display: 'flex', width: 160 * scale, height: 4, borderRadius: 4, backgroundColor: accent, marginTop: 16 * scale, marginBottom: 16 * scale }} />
        <div style={{ display: 'flex', fontSize: 26 * scale, color: theme.textSoft }}>{certificateSentence(place)}</div>
        <div style={{ display: 'flex', marginTop: 8 * scale, fontFamily: theme.fontDisplay, fontSize: (tournamentName.length > 28 ? 36 : 44) * scale, fontWeight: 700 }}>{tournamentName}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 20 * scale, color: theme.textSoft }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex' }}>Organização: {organizerName}</div>
          <div style={{ display: 'flex' }}>{dateLabel}</div>
        </div>
        <div style={{ display: 'flex' }}>{siteLabel}</div>
      </div>
    </div>
  );
}
