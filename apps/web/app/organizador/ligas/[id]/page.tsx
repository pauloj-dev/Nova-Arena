'use client';

import { use } from 'react';
import { ManageLeaguePage } from '@/features/leagues/OrganizerLeagues';

export default function GerenciarLigaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ManageLeaguePage id={id} />;
}
