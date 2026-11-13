'use client';

import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { RequireRole } from '@/shared/layout/RequireRole';

export default function NotificacoesPage() {
  return (
    <RequireRole>
      <NotificationsPage />
    </RequireRole>
  );
}
