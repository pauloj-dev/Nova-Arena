'use client';

import { use } from 'react';
import { GamePage } from '@/features/games/GamePage';

export default function GameRoute({ params }: { params: Promise<{ game: string }> }) {
  const { game } = use(params);
  return <GamePage slug={game} />;
}
