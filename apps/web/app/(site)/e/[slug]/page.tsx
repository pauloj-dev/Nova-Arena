'use client';

import { use } from 'react';
import { EventPage } from '@/features/events/EventPage';

export default function EventoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <EventPage slug={slug} />;
}
