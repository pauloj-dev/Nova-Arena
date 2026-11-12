'use client';

import { Badge } from '@nova/ui';
import { WifiOff } from 'lucide-react';
import { useRealtimeStatus } from './RealtimeProvider';

/**
 * "AO VIVO" enquanto o tempo real está conectado; quando a conexão cai, avisa que a página
 * segue atualizando sozinha a cada 10 segundos (PRD §15.8 e CT-10).
 */
export function LiveIndicator({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  if (status === 'disconnected') {
    return (
      <Badge tone="warning" className={className} icon={<WifiOff className="size-3.5" aria-hidden />} role="status">
        Reconectando… atualizando a cada 10 s
      </Badge>
    );
  }
  return (
    <Badge tone="primary" className={className} icon={<span className="size-2 rounded-full bg-primary-500 animate-pulse-live" aria-hidden />} role="status">
      AO VIVO
    </Badge>
  );
}
