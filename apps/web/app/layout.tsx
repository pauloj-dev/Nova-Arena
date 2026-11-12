import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Rajdhani } from 'next/font/google';
import { themeInitScript } from '@/shared/theme/theme';
import { Providers } from './providers';
import './globals.css';

// Fontes servidas pelo próprio site (next/font): sem requisição a terceiros no navegador.
const rajdhani = Rajdhani({ variable: '--font-rajdhani', subsets: ['latin'], weight: ['600', '700'], display: 'swap' });
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], weight: ['600'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Nova Arena — campeonatos de eSports mobile', template: '%s · Nova Arena' },
  description: 'Crie, organize e acompanhe campeonatos de Free Fire, Clash Royale, 8 Ball Pool, eFootball e outros jogos.',
  applicationName: 'Nova Arena',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8faf9' },
    { media: '(prefers-color-scheme: dark)', color: '#07130d' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${rajdhani.variable} ${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">
          Pular para o conteúdo
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
