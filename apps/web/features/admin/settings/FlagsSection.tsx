'use client';

import { Card, ErrorState, Skeleton, Switch, useToast } from '@nova/ui';
import { errorMessage } from '@/shared/api/client';
import { useAdminFlags, useSetFlag } from '@/shared/api/hooks/admin-settings';

/**
 * Recursos liga/desliga (feature flags). Mudar aqui muda o site na hora, sem novo deploy:
 * a consulta pública das flags é invalidada e as telas que usam `useFlag` reagem.
 */
export function FlagsSection({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const flags = useAdminFlags();
  const setFlag = useSetFlag();

  return (
    <Card>
      <section aria-labelledby="flags" className="flex flex-col gap-3">
        <div>
          <h2 id="flags" className="text-lg">
            Recursos
          </h2>
          <p className="text-sm text-muted">Ligue ou desligue partes do site. A mudança vale na hora, para todo mundo, e fica na auditoria.</p>
        </div>
        {flags.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Carregando recursos">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : flags.isError ? (
          <ErrorState description={errorMessage(flags.error)} onRetry={() => void flags.refetch()} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {flags.data.map((flag) => (
              <li key={flag.key} data-testid={`flag-${flag.key}`}>
                <Switch
                  label={flag.label}
                  hint={flag.description}
                  checked={flag.enabled}
                  disabled={!canEdit || (setFlag.isPending && setFlag.variables?.key === flag.key)}
                  onCheckedChange={(enabled) =>
                    setFlag.mutate(
                      { key: flag.key, enabled },
                      {
                        onSuccess: () => toast.success(enabled ? `${flag.label}: ligado` : `${flag.label}: desligado`, 'O site já está usando a nova configuração.'),
                        onError: (error) => toast.error('Não foi possível mudar o recurso', errorMessage(error)),
                      },
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
