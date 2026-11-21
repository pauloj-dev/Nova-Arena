'use client';

import { Card, ErrorState, Skeleton, Switch, useToast } from '@nova/ui';
import { errorMessage } from '@/shared/api/client';
import { useAdminFlags, useSetFlag } from '@/shared/api/hooks/admin-settings';
import { useT } from '@/shared/i18n/react';
import { adminSettingsMessages } from './messages';

/**
 * Recursos liga/desliga (feature flags). Mudar aqui muda o site na hora, sem novo deploy:
 * a consulta pública das flags é invalidada e as telas que usam `useFlag` reagem.
 */
export function FlagsSection({ canEdit }: { canEdit: boolean }) {
  const t = useT(adminSettingsMessages, 'FlagsSection');
  const toast = useToast();
  const flags = useAdminFlags();
  const setFlag = useSetFlag();

  return (
    <Card>
      <section aria-labelledby="flags" className="flex flex-col gap-3">
        <div>
          <h2 id="flags" className="text-lg">
            {t('titulo')}
          </h2>
          <p className="text-sm text-muted">{t('descricao')}</p>
        </div>
        {flags.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label={t('carregando')}>
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
                        onSuccess: () => toast.success(enabled ? t('ligado', { recurso: flag.label }) : t('desligado', { recurso: flag.label }), t('toastDetalhe')),
                        onError: (error) => toast.error(t('toastErro'), errorMessage(error)),
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
