import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StatusPill } from '../components/Badge';
import { Tabs, type TabItem } from '../components/Surface';
import { squads } from './fixtures';

const items: TabItem[] = [
  {
    value: 'visao-geral',
    label: 'Visão geral',
    content: <p className="text-sm text-text">Copa Booyah de Verão: 6 quedas em Bermuda, Purgatório e Kalahari. Os 12 melhores squads vão para a final.</p>,
  },
  {
    value: 'squads',
    label: 'Squads',
    content: (
      <ul className="flex flex-col gap-2">
        {squads.slice(0, 4).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 text-sm text-text">
            {s.name}
            <StatusPill status={s.status} />
          </li>
        ))}
      </ul>
    ),
  },
  { value: 'tabela', label: 'Tabela', content: <p className="text-sm text-text">A tabela aparece depois da primeira queda validada.</p> },
  { value: 'premiacao', label: 'Premiação', content: <p className="text-sm text-text">1º lugar: R$ 3.000 · 2º lugar: R$ 1.500 · 3º lugar: R$ 500.</p> },
];

const meta = {
  title: 'Navegação/Tabs',
  component: Tabs,
  args: { items, label: 'Seções do campeonato' },
  argTypes: { items: { control: false } },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const AbaInicial: Story = { name: 'Começando em outra aba', args: { defaultValue: 'squads' } };

export const ComAbaDesabilitada: Story = {
  name: 'Com aba desabilitada',
  args: { items: items.map((t) => (t.value === 'tabela' ? { ...t, disabled: true } : t)) },
};

function ControlledTabs() {
  const [value, setValue] = useState('premiacao');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Aba atual: <span className="font-semibold text-text">{items.find((t) => t.value === value)?.label}</span>
      </p>
      <Tabs items={items} label="Seções do campeonato" value={value} onValueChange={setValue} />
    </div>
  );
}

export const Controlada: Story = { render: () => <ControlledTabs /> };

export const MuitasAbasNoCelular: Story = {
  name: 'Muitas abas no celular (rola para o lado)',
  args: {
    items: [...items, { value: 'regras', label: 'Regras', content: <p className="text-sm text-text">Regulamento completo.</p> }, { value: 'disputas', label: 'Disputas', content: <p className="text-sm text-text">Nenhuma disputa aberta.</p> }],
  },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
