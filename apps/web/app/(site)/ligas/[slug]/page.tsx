'use client';

import { use } from 'react';
import { LeaguePage } from '@/features/leagues/LeaguePage';

export default function LigaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <LeaguePage slug={slug} />;
}
