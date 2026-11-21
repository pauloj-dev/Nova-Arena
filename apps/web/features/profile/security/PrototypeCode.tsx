'use client';

import { Badge, Button, Skeleton } from '@nova/ui';
import { FlaskConical } from 'lucide-react';
import { useTwoFactorDevCode } from '@/shared/api/hooks/admin-security';
import { isModuleMocked } from '@/shared/api/mode';

/** O atalho do código de demonstração só existe com a API simulada (o login e o 2FA no protótipo). */
export function prototypeCodeAvailable(): boolean {
  return isModuleMocked('auth') && isModuleMocked('admin-settings');
}

/**
 * Só no protótipo: mostra o código do momento, para a demonstração funcionar sem aplicativo autenticador.
 * Na versão final este aviso não existe (o código só existe no aparelho da pessoa).
 */
export function PrototypeCode({ onUse }: { onUse: (code: string) => void }) {
  const dev = useTwoFactorDevCode(true);
  return (
    <div role="note" className="flex flex-col gap-2 rounded-md border border-border-strong bg-info-soft px-3 py-3 text-sm text-info-soft-text" data-testid="prototype-code">
      <Badge tone="info" className="self-start border border-info" icon={<FlaskConical className="size-3.5" aria-hidden />}>
        Protótipo
      </Badge>
      <p>Sem aplicativo autenticador à mão? No protótipo, o código do momento aparece aqui. Na versão final ele só existe no seu celular.</p>
      {dev.data ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular font-mono text-lg font-bold tracking-widest" data-testid="dev-code">
            {dev.data.code}
          </span>
          <span className="text-xs">troca em {dev.data.expiresInSeconds} s</span>
          <Button size="sm" variant="secondary" onClick={() => onUse(dev.data.code)}>
            Usar este código
          </Button>
        </div>
      ) : dev.isError ? (
        <p>Não foi possível buscar o código agora.</p>
      ) : (
        <Skeleton className="h-8 w-40" />
      )}
    </div>
  );
}
