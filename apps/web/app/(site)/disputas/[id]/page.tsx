'use client';

import { use } from 'react';
import { DisputePage } from '@/features/disputes/DisputePage';
import { RequireRole } from '@/shared/layout/RequireRole';

export default function DisputaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireRole>
      <DisputePage disputeId={id} />
    </RequireRole>
  );
}
