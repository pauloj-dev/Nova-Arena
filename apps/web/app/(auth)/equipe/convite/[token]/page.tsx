'use client';

import { use } from 'react';
import { StaffInviteScreen } from '@/features/auth/StaffInviteScreen';

/** O segmento pode chegar codificado; um `%` solto não pode derrubar a página. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Convite por link para a equipe de um campeonato (co-organizador ou moderador). */
export default function StaffInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <StaffInviteScreen token={decodeSegment(token)} />;
}
