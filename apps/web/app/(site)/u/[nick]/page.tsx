'use client';

import { use } from 'react';
import { PublicProfile } from '@/features/profile/PublicProfile';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Sequência `%` malformada: segue com o texto como veio (vai dar "Perfil não encontrado").
    return value;
  }
}

export default function PublicProfilePage({ params }: { params: Promise<{ nick: string }> }) {
  const { nick } = use(params);
  return <PublicProfile nickname={safeDecode(nick)} />;
}
