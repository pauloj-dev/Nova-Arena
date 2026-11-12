'use client';

import { use } from 'react';
import { ArtworkPage } from '@/features/artwork/ArtworkPage';

export default function ArtworkRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <ArtworkPage key={slug} slug={slug} />;
}
