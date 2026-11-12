import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorState } from '../components/Surface';

const meta = {
  title: 'Feedback/ErrorState',
  component: ErrorState,
  decorators: [(Story) => <div className="max-w-lg">{Story()}</div>],
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão (só o título)' };

export const ComTentarNovamente: Story = {
  name: 'Com "Tentar novamente"',
  args: {
    title: 'Não foi possível carregar a tabela',
    description: 'A conexão caiu no meio do caminho. Seus pontos estão salvos.',
    onRetry: () => {},
  },
};

export const ComConteudoExtra: Story = {
  name: 'Com conteúdo extra',
  args: {
    title: 'Este campeonato não existe mais',
    description: 'Ele pode ter sido cancelado pela organização.',
    children: (
      <a href="#campeonatos" className="text-sm font-semibold underline">
        Ver campeonatos abertos
      </a>
    ),
  },
};
