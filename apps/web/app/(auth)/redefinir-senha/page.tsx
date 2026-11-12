'use client';

import { Suspense } from 'react';
import { AuthSkeleton } from '@/features/auth/AuthParts';
import { ResetPasswordScreen } from '@/features/auth/ResetPasswordScreen';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
