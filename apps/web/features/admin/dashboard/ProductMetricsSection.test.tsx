import type { ProductMetrics } from '@nova/schemas';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatMetric, ProductMetricsSection } from './ProductMetricsSection';

const data: ProductMetrics = {
  from: '2026-10-23',
  to: '2026-11-21',
  generatedAt: '2026-11-21T12:00:00.000Z',
  northStar: { thisWeek: 12, lastWeek: 9, weekly: [] },
  metrics: [
    { key: 'publishTime', group: 'OKR', label: 'Tempo médio para criar e publicar um campeonato', value: 8.5, unit: 'minutes', target: 10, direction: 'max', targetLabel: '≤ 10 min', status: 'ok', sample: 4, detail: 'Do rascunho à publicação.' },
    { key: 'walkoverRate', group: 'OKR', label: 'Taxa de W.O.', value: 0.125, unit: 'percent', target: 0.08, direction: 'max', targetLabel: '≤ 8%', status: 'attention', sample: 40, detail: 'Partidas por W.O.' },
    { key: 'npsParticipants', group: 'HEART', label: 'NPS dos participantes', value: null, unit: 'score', target: 40, direction: 'min', targetLabel: '≥ 40', status: 'no_data', sample: 0, detail: 'Pesquisa.' },
  ],
};

describe('<ProductMetricsSection />', () => {
  it('mostra valor, meta e situação com ícone e texto (não só cor), separando OKRs e HEART', () => {
    render(<ProductMetricsSection data={data} loading={false} failed={false} onRetry={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Metas do produto (OKRs)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Experiência (HEART)' })).toBeInTheDocument();
    expect(screen.getByTestId('metric-publishTime')).toHaveTextContent('8,5 min');
    expect(screen.getByTestId('metric-walkoverRate')).toHaveTextContent('12,5%');
    expect(screen.getByTestId('metric-npsParticipants')).toHaveTextContent('—');
    expect(screen.getByText('Dentro da meta')).toBeInTheDocument();
    expect(screen.getByText('Fora da meta')).toBeInTheDocument();
    expect(screen.getByText('Sem dados no período')).toBeInTheDocument();
    expect(screen.getByText(/North Star: 12 partidas validadas/)).toBeInTheDocument();
  });

  it('sem resposta da API: aviso e botão para tentar de novo', () => {
    const retry = vi.fn();
    render(<ProductMetricsSection data={undefined} loading={false} failed onRetry={retry} />);
    screen.getByRole('button', { name: 'Tentar de novo' }).click();
    expect(retry).toHaveBeenCalled();
  });

  it('formata cada unidade', () => {
    expect(formatMetric(42, 'seconds')).toBe('42 s');
    expect(formatMetric(40, 'score')).toBe('+40');
    expect(formatMetric(-10, 'score')).toBe('-10');
    expect(formatMetric(4.25, 'count')).toBe('4,3');
  });
});
