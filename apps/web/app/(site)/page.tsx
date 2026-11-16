/** Página inicial. O conteúdo é do navegador (destaques, próximas partidas); a URL canônica vem do servidor. */
import type { Metadata } from 'next';
import { HomePage } from '@/features/home/HomePage';

export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function Home() {
  return <HomePage />;
}
