'use client';

import { Suspense } from 'react';
import { AuthSkeleton } from '@/features/auth/AuthParts';
import { LoginScreen } from '@/features/auth/LoginScreen';

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <LoginScreen />
    </Suspense>
  );
}
