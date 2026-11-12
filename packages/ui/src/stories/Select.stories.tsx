import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from '../components/Field';
import { gameOptions } from './fixtures';

const meta = {
  title: 'Formulário/Select',
  component: Select,
  args: { label: 'Jogo', options: gameOptions, placeholder: 'Escolha o jogo' },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const ComValor: Story = {
  name: 'Com valor',
  args: { defaultValue: 'free-fire', hint: 'A opção desabilitada ainda não tem regras de pontuação.' },
};

export const ComErro: Story = {
  name: 'Com erro',
  args: { required: true, error: 'Escolha um jogo para continuar.' },
};

export const Desabilitado: Story = {
  args: { disabled: true, defaultValue: 'free-fire' },
};

export const Formato: Story = {
  args: {
    label: 'Formato da fase',
    placeholder: undefined,
    defaultValue: 'br-pontos',
    options: [
      { value: 'br-pontos', label: 'Battle Royale por pontos' },
      { value: 'grupos', label: 'Fase de grupos' },
      { value: 'mata-mata', label: 'Mata-mata (eliminação simples)' },
      { value: 'dupla', label: 'Eliminação dupla' },
    ],
  },
};
