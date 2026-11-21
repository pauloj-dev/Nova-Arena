import type { Metadata } from 'next';

/** Modo telão (issue #124): tela cheia, sem o cabeçalho do site, para transmissão no OBS. Fora das buscas. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function TelaoLayout({ children }: LayoutProps<'/'>) {
  return children;
}
