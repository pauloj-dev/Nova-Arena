'use client';

import { use } from 'react';
import { ModerationPage } from '@/features/admin/moderation/ModerationPage';

export default function AdminModerationPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba } = use(searchParams);
  return <ModerationPage initialTab={aba} />;
}
