'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';

/** Sino de notificações. A lista e o contador entram em F2.10. */
export function NotificationBell() {
  return (
    <Link href="/notificacoes" aria-label="Notificações" className="flex size-11 items-center justify-center rounded-md hover:bg-neutral-soft">
      <Bell className="size-5" aria-hidden />
    </Link>
  );
}
