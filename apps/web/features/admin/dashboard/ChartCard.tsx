import { Card } from '@nova/ui';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ChartTableRow {
  label: string;
  value: string;
}

interface ChartCardProps {
  title: string;
  /** Resumo em uma linha (total do período, por exemplo). */
  summary: string;
  /** O gráfico. Nulo quando não há dados: aparece `emptyText`. */
  chart: ReactNode | null;
  emptyText: string;
  /** Cabeçalhos e linhas da tabela alternativa (os mesmos números do gráfico). */
  tableHead: [string, string];
  tableRows: ChartTableRow[];
  className?: string;
}

/**
 * Moldura de um gráfico do dashboard: título, resumo, o gráfico e, sempre, a tabela com os mesmos
 * números (aberta por um "Ver em tabela"). A tabela é a alternativa acessível do gráfico.
 */
export function ChartCard({ title, summary, chart, emptyText, tableHead, tableRows, className }: ChartCardProps) {
  return (
    <Card className={className}>
      <section aria-label={title} className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-lg">{title}</h2>
          <p className="text-sm text-muted">{summary}</p>
        </div>
        {chart ?? <p className="flex h-60 items-center justify-center rounded-md border border-dashed border-border-strong px-4 text-center text-sm text-muted">{emptyText}</p>}
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-semibold text-primary-text md:min-h-8 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            Ver em tabela
          </summary>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{title}: os números do gráfico</caption>
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {tableHead[0]}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {tableHead[1]}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.label} className="border-t border-border">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      {row.label}
                    </th>
                    <td className="tabular px-3 py-1.5 text-right">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </Card>
  );
}
