'use client';

import { Suspense } from 'react';
import { AuthSkeleton } from '@/features/auth/AuthParts';
import { VerifyEmailScreen } from '@/features/auth/VerifyEmailScreen';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <VerifyEmailScreen />
    </Suspense>
  );
}
