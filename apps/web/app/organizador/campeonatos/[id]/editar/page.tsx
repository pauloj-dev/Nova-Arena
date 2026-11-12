'use client';

import { use } from 'react';
import { TournamentWizard } from '@/features/organizer/wizard/TournamentWizard';

export default function EditTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TournamentWizard key={id} tournamentId={id} />;
}
