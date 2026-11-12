import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchX, Trophy, Users } from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/Surface';

const meta = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
  args: {
    title: 'Nenhum campeonato de Free Fire aberto',
    description: 'Siga o jogo para saber quando abrir uma nova inscrição.',
  },
  argTypes: { icon: { control: false }, action: { control: false } },
  decorators: [(Story) => <div className="max-w-lg">{Story()}</div>],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completo: Story = {
  args: { icon: <Trophy className="size-7" />, action: <Button>Seguir Free Fire</Button> },
};

export const SemSquad: Story = {
  name: 'Sem squad',
  args: {
    icon: <Users className="size-7" />,
    title: 'Você ainda não tem um squad',
    description: 'Crie um squad e convide até 3 amigos para se inscrever em campeonatos de Battle Royale.',
    action: <Button>Criar squad</Button>,
  },
};

export const BuscaSemResultado: Story = {
  name: 'Busca sem resultado',
  args: {
    icon: <SearchX className="size-7" />,
    title: 'Nada encontrado para "copa bermuda"',
    description: 'Confira a grafia ou tire algum filtro.',
    action: <Button variant="secondary">Limpar filtros</Button>,
  },
};

export const SoTitulo: Story = {
  name: 'Só título',
  args: { title: 'Nenhuma disputa aberta', description: undefined },
};
