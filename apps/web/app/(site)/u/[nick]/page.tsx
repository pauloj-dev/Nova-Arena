/**
 * Perfil público (issue #77): renderizado no servidor com os dados em cache, revalidados quando o perfil muda.
 * Só dados públicos (sem e-mail e sem IDs de jogo). Com a API simulada, carrega no navegador, como antes.
 */
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { appMessages } from '@/app/messages';
import { PublicProfile } from '@/features/profile/PublicProfile';
import { keys } from '@/shared/api/keys';
import { getT } from '@/shared/i18n/core';
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
  const t = getT(appMessages, 'paginas.perfil');
  if (!user) return { title: t('tituloPadrao'), alternates: { canonical } };
  const description = user.bio?.trim() || t('descricao', { nick: user.nickname });
  return {
    title: user.nickname,
    description,
    alternates: { canonical },
    openGraph: { type: 'profile', url: canonical, title: t('tituloCompartilhado', { nick: user.nickname }), description, ...(user.avatarUrl?.startsWith('https://') ? { images: [user.avatarUrl] } : {}) },
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
