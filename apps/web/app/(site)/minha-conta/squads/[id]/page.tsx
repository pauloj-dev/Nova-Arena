'use client';

import { use } from 'react';
import { TeamDetailPage } from '@/features/teams/TeamDetailPage';

export default function SquadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TeamDetailPage teamId={decodeURIComponent(id)} />;
}
