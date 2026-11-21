'use client';

import { Button, EmptyState, ErrorState } from '@nova/ui';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { AuditTimeline } from '@/features/admin/audit/AuditTimeline';
import { errorMessage } from '@/shared/api/client';
import { useTournamentAuditLogs } from '@/shared/api/hooks/admin-audit';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

/** Aba Auditoria: tudo o que foi feito neste campeonato (chave, resultados, equipe, status), com quem fez e quando. */
export function AuditTab({ tournamentId }: { tournamentId: string }) {
  const t = useT(messages, 'AuditTab');
  const [page, setPage] = useState(1);
  const query = useTournamentAuditLogs(tournamentId, { page });

  if (query.error && !query.data) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const pageCount = query.data?.pageCount ?? 1;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{query.data ? t('descricaoComTotal', { total: query.data.total }) : t('descricao')}</p>
      <AuditTimeline
        logs={query.data?.items}
        loading={query.isPending}
        label={t('rotulo')}
        empty={<EmptyState icon={<ScrollText className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />}
      />
      {pageCount > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label={t('paginas')}>
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {t('maisRecentes')}
          </Button>
          <span className="text-sm text-muted" role="status">
            {t('paginaDe', { pagina: query.data?.page ?? page, total: pageCount })}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            {t('maisAntigos')}
          </Button>
        </nav>
      )}
    </div>
  );
}
