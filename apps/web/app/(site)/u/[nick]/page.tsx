/**
 * Perfil público (issue #77): renderizado no servidor com os dados em cache, revalidados quando o perfil muda.
 * Só dados públicos (sem e-mail e sem IDs de jogo). Com a API simulada, carrega no navegador, como antes.
 */
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { PublicProfile } from '@/features/profile/PublicProfile';
import { keys } from '@/shared/api/keys';
import { getPublicProfile } from '@/shared/server/public-data';

type Props = { params: Promise<{ nick: string }> };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Sequência `%` malformada: segue com o texto como veio (vai dar "Perfil não encontrado").
    return value;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const nickname = safeDecode((await params).nick);
  const canonical = `/u/${encodeURIComponent(nickname)}`;
  const user = await getPublicProfile(nickname).catch(() => null);
  if (!user) return { title: 'Perfil', alternates: { canonical } };
  const description = user.bio?.trim() || `Perfil de ${user.nickname} na Nova Arena: campeonatos, squads e resultados.`;
  return {
    title: user.nickname,
    description,
    alternates: { canonical },
    openGraph: { type: 'profile', url: canonical, title: `${user.nickname} · Nova Arena`, description, ...(user.avatarUrl?.startsWith('https://') ? { images: [user.avatarUrl] } : {}) },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const nickname = safeDecode((await params).nick);
  const user = await getPublicProfile(nickname).catch(() => null);
  const client = new QueryClient();
  if (user) client.setQueryData(keys.users.profile(nickname.toLowerCase()), user);
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <PublicProfile nickname={nickname} />
    </HydrationBoundary>
  );
}
