'use client';

import { Suspense } from 'react';
import { AuthSkeleton } from '@/features/auth/AuthParts';
import { ForgotPasswordScreen } from '@/features/auth/ForgotPasswordScreen';

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <ForgotPasswordScreen />
    </Suspense>
  );
}
