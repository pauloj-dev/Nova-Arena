'use client';

import { Suspense } from 'react';
import { AuthSkeleton } from '@/features/auth/AuthParts';
import { RegisterScreen } from '@/features/auth/RegisterScreen';

export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <RegisterScreen />
    </Suspense>
  );
}
