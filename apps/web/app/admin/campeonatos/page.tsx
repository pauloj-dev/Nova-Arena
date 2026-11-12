'use client';

import { use } from 'react';
import { AdminTournamentsPage } from '@/features/admin/tournaments/AdminTournamentsPage';

export default function AdminTournamentsRoute({ searchParams }: { searchParams: Promise<{ fila?: string }> }) {
  const { fila } = use(searchParams);
  return <AdminTournamentsPage initialQueue={fila} />;
}
