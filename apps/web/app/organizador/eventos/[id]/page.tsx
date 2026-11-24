'use client';

import { use } from 'react';
import { ManageEventPage } from '@/features/events/OrganizerEvents';

export default function GerenciarEventoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ManageEventPage id={id} />;
}
