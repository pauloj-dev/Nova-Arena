'use client';

import { use } from 'react';
import { UserDetailPage } from '@/features/admin/users/UserDetailPage';

export default function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <UserDetailPage userId={id} />;
}
