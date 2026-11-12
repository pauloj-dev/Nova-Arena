'use client';

import { use } from 'react';
import { OrganizersPage } from '@/features/admin/roles/OrganizersPage';

export default function AdminOrganizersPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba } = use(searchParams);
  return <OrganizersPage initialTab={aba} />;
}
