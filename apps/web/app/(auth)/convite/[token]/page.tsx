'use client';

import { use } from 'react';
import { RoleInviteScreen } from '@/features/auth/RoleInviteScreen';

/** O segmento pode chegar codificado; um `%` solto não pode derrubar a página. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function RoleInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <RoleInviteScreen token={decodeSegment(token)} />;
}
