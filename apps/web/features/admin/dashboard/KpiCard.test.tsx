import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { formatNumber, formatPercent } from '../common/format';
import { KpiCard } from './KpiCard';

describe('<KpiCard />', () => {
  it('mostra o rótulo, o número em fonte tabular e leva para a tela correspondente', () => {
    render(<KpiCard label="Usuários ativos" value={formatNumber(12480)} hint="de 13.000 contas" icon={Users} href="/admin/usuarios" linkLabel="Ver usuários" />);
    const link = screen.getByRole('link', { name: 'Usuários ativos: 12.480, de 13.000 contas. Ver usuários' });
    expect(link).toHaveAttribute('href', '/admin/usuarios');
    const value = screen.getByTestId('kpi-value');
    expect(value).toHaveTextContent('12.480');
    expect(value).toHaveClass('tabular');
    expect(screen.getByText('Usuários ativos')).toBeInTheDocument();
    expect(screen.getByText('de 13.000 contas')).toBeInTheDocument();
    expect(screen.queryByText('Pede atenção')).toBeNull();
  });

  it('fila com itens em aberto pede atenção com ícone e texto, não só com cor', () => {
    render(<KpiCard label="Disputas abertas" value="7" icon={Users} href="/admin/moderacao" linkLabel="Abrir a moderação" attention />);
    expect(screen.getByText('Pede atenção')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disputas abertas: 7. Pede atenção. Abrir a moderação' })).toBeInTheDocument();
  });

  it('enquanto carrega mostra o esqueleto no lugar do número e mantém o atalho', () => {
    render(<KpiCard label="Campeonatos ativos" value={undefined} icon={Users} href="/admin/campeonatos" linkLabel="Ver campeonatos" />);
    expect(screen.queryByTestId('kpi-value')).toBeNull();
    expect(screen.getByRole('link', { name: 'Campeonatos ativos: carregando. Ver campeonatos' })).toHaveAttribute('href', '/admin/campeonatos');
  });

  it('zero aparece como "0" (não some nem vira traço)', () => {
    render(<KpiCard label="Denúncias abertas" value={formatNumber(0)} icon={Users} href="/admin/moderacao" linkLabel="Abrir a moderação" />);
    expect(screen.getByTestId('kpi-value')).toHaveTextContent('0');
  });
});

describe('formatação dos indicadores', () => {
  it('milhar com ponto e porcentagem com vírgula, em pt-BR', () => {
    expect(formatNumber(1932)).toBe('1.932');
    expect(formatNumber(86)).toBe('86');
    expect(formatPercent(0.083)).toBe('8,3%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
  });
});
