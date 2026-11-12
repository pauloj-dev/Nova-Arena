'use client';

import { use } from 'react';
import { GameDetailPage } from '@/features/admin/games/GameDetailPage';

export default function AdminGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GameDetailPage gameId={id} />;
}
