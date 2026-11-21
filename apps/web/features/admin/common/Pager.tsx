import { Button } from '@nova/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@/shared/i18n/react';
import { adminCommonMessages } from './messages';

/** Paginação numerada para listas que não são tabela (linha do tempo, cartões). Mesmo desenho do `DataTable`. */
export function Pager({ page, pageCount, total, onPageChange, label }: { page: number; pageCount: number; total?: number; onPageChange: (page: number) => void; label?: string }) {
  const t = useT(adminCommonMessages, 'Pager');
  if (pageCount <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label={label ?? t('rotulo')}>
      <span className="text-muted">
        {t('pagina', { page: String(page), pageCount: String(pageCount) })}
        {total !== undefined && t('total', { total: String(total) })}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} iconLeft={<ChevronLeft className="size-4" aria-hidden />}>
          {t('anterior')}
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} iconRight={<ChevronRight className="size-4" aria-hidden />}>
          {t('proxima')}
        </Button>
      </div>
    </nav>
  );
}
