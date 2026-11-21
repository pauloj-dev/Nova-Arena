'use client';

import { useEffect, useRef, useState } from 'react';
import { useUnreadCount } from '../api/hooks/notifications';
import { sharedMessages } from '../i18n/messages';
import { useT } from '../i18n/react';
import { useSession } from '../session/useSession';

/**
 * Anuncia ao leitor de tela quando chegam notificações novas (RNF-11, `aria-live` nas mudanças ao vivo).
 * O sino muda o próprio nome acessível, mas mudança de nome não é lida: esta região educada avisa uma vez a
 * cada aumento do total de não lidas (não fala na primeira carga nem quando o total cai).
 */
export function UnreadAnnouncer() {
  const { user } = useSession();
  const t = useT(sharedMessages, 'UnreadAnnouncer');
  const unread = useUnreadCount(Boolean(user));
  const count = unread.data;
  const previous = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (count === undefined) return;
    const before = previous.current;
    previous.current = count;
    if (before === undefined || count <= before) return;
    const novas = count - before;
    const id = requestAnimationFrame(() => setMessage(t('aviso', { novas, total: String(count) })));
    return () => cancelAnimationFrame(id);
  }, [count, t]);

  if (!user) return null;
  return (
    <p className="sr-only" role="status" aria-live="polite" data-testid="unread-announcer">
      {message}
    </p>
  );
}
