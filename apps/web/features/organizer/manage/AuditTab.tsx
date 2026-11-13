'use client';

import { Button, EmptyState, ErrorState } from '@nova/ui';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { AuditTimeline } from '@/features/admin/audit/AuditTimeline';
import { errorMessage } from '@/shared/api/client';
import { useTournamentAuditLogs } from '@/shared/api/hooks/admin-audit';

/** Aba Auditoria: tudo o que foi feito neste campeonato (chave, resultados, equipe, status), com quem fez e quando. */
export function AuditTab({ tournamentId }: { tournamentId: string }) {
  const [page, setPage] = useState(1);
  const query = useTournamentAuditLogs(tournamentId, { page });

  if (query.error && !query.data) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const pageCount = query.data?.pageCount ?? 1;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Registro somente de leitura das ações sensíveis deste campeonato{query.data ? ` · ${query.data.total} ${query.data.total === 1 ? 'registro' : 'registros'}` : ''}.</p>
      <AuditTimeline
        logs={query.data?.items}
        loading={query.isPending}
        label="Auditoria do campeonato"
        empty={<EmptyState icon={<ScrollText className="size-7" />} title="Nada registrado ainda" description="Gerar chave, lançar resultados, mudar a equipe e pausar o campeonato aparecem aqui." />}
      />
      {pageCount > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label="Páginas da auditoria">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Mais recentes
          </Button>
          <span className="text-sm text-muted" role="status">
            Página {query.data?.page ?? page} de {pageCount}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Mais antigos
          </Button>
        </nav>
      )}
    </div>
  );
}
