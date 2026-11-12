import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, Skeleton } from '../components/Surface';

const meta = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  args: { className: 'h-5 w-64' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linha: Story = {};

export const CartaoDeCampeonato: Story = {
  name: 'Cartão de campeonato carregando',
  render: () => (
    <Card className="max-w-sm" role="status" aria-busy="true" aria-label="Carregando campeonato">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-11 w-full" />
      </div>
    </Card>
  ),
};

export const ListaDeSquads: Story = {
  name: 'Lista de squads carregando',
  render: () => (
    <ul className="flex max-w-sm flex-col gap-3" aria-busy="true" aria-label="Carregando squads">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  ),
};
