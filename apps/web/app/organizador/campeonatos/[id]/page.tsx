'use client';

import { use } from 'react';
import { ManageTournament } from '@/features/organizer/manage/ManageTournament';

export default function ManageTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ManageTournament key={id} tournamentId={id} />;
}
