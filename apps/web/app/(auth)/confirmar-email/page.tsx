'use client';

import { Suspense } from 'react';
import { AuthSkeleton } from '@/features/auth/AuthParts';
import { ConfirmEmailChangeScreen } from '@/features/auth/ConfirmEmailChangeScreen';

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <ConfirmEmailChangeScreen />
    </Suspense>
  );
}
