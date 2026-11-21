import { cn } from '@nova/ui';
import { ArrowRight, Equal, Minus, Plus } from 'lucide-react';
import { useT } from '@/shared/i18n/react';
import { diffAudit, type AuditValues, type DiffRow } from './diff';
import { adminAuditMessages } from './messages';

const KIND_ICON: Record<DiffRow['kind'], typeof Plus> = {
  changed: ArrowRight,
  added: Plus,
  removed: Minus,
  same: Equal,
};

/**
 * Antes e depois lado a lado, campo a campo. O que mudou vem primeiro e é marcado com ícone e texto
 * (não só cor). Em telas estreitas as duas colunas continuam lado a lado, com quebra de linha.
 */
export function AuditDiff({ before, after, className }: { before: AuditValues; after: AuditValues; className?: string }) {
  const t = useT(adminAuditMessages, 'AuditDiff');
  const rows = diffAudit(before, after);
  if (rows.length === 0) return <p className={cn('text-sm text-muted', className)}>{t('semCampos')}</p>;
  return (
    <div className={cn('overflow-hidden rounded-md border border-border', className)}>
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t('legenda')}</caption>
        <thead className="bg-surface-2 text-left text-xs text-muted">
          <tr>
            <th scope="col" className="w-[30%] px-3 py-2 font-semibold">
              {t('campo')}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {t('antes')}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {t('depois')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const KindIcon = KIND_ICON[row.kind];
            const changed = row.kind !== 'same';
            return (
              <tr key={row.key} data-kind={row.kind} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium text-text [overflow-wrap:anywhere]">
                  {row.label}
                  <span className={cn('mt-0.5 flex items-center gap-1 text-xs font-normal', changed ? 'text-primary-text' : 'text-muted')}>
                    <KindIcon className="size-3 shrink-0" aria-hidden />
                    {t(`tipo.${row.kind}`)}
                  </span>
                </th>
                <td className={cn('px-3 py-2 [overflow-wrap:anywhere]', row.kind === 'changed' || row.kind === 'removed' ? 'bg-danger-soft text-danger-soft-text' : 'text-muted')}>
                  {row.kind === 'changed' || row.kind === 'removed' ? <del className="no-underline">{row.before}</del> : row.before}
                </td>
                <td className={cn('px-3 py-2 [overflow-wrap:anywhere]', row.kind === 'changed' || row.kind === 'added' ? 'bg-primary-soft font-medium text-primary-soft-text' : 'text-muted')}>
                  {row.kind === 'changed' || row.kind === 'added' ? <ins className="no-underline">{row.after}</ins> : row.after}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
