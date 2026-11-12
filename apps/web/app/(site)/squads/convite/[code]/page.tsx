'use client';

import { use } from 'react';
import { TeamInvitePage } from '@/features/teams/TeamInvitePage';

export default function ConviteSquadPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <TeamInvitePage code={decodeURIComponent(code)} />;
}
