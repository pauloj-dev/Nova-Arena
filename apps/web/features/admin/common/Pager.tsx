import { Button } from '@nova/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Paginação numerada para listas que não são tabela (linha do tempo, cartões). Mesmo desenho do `DataTable`. */
export function Pager({ page, pageCount, total, onPageChange, label = 'Paginação' }: { page: number; pageCount: number; total?: number; onPageChange: (page: number) => void; label?: string }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label={label}>
      <span className="text-muted">
        Página {page} de {pageCount}
        {total !== undefined && ` · ${total} no total`}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} iconLeft={<ChevronLeft className="size-4" aria-hidden />}>
          Anterior
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} iconRight={<ChevronRight className="size-4" aria-hidden />}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}
