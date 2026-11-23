'use client';

import dynamic from 'next/dynamic';

/**
 * Sino de notificações carregado depois da página (#111): o painel (Radix Popover + posicionamento), a lista e o
 * convite de push só interessam a quem está logado e não precisam estar no JS inicial. Enquanto carrega, um espaço
 * do mesmo tamanho do botão evita salto no cabeçalho.
 */
export const NotificationBell = dynamic(() => import('./NotificationBell').then((m) => m.NotificationBell), {
  ssr: false,
  loading: () => <span className="block size-11" aria-hidden />,
});
