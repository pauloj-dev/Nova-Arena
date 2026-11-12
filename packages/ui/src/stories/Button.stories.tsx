import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Plus, Trash2, Trophy } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from '../components/Button';

const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'gold'];
const sizes: ButtonSize[] = ['sm', 'md', 'lg'];
const labels: Record<ButtonVariant, string> = {
  primary: 'Inscrever squad',
  secondary: 'Ver regulamento',
  ghost: 'Agora não',
  danger: 'Cancelar campeonato',
  gold: 'Ver premiação',
};

const meta = {
  title: 'Ações/Button',
  component: Button,
  args: { children: 'Inscrever squad', variant: 'primary', size: 'md', loading: false, disabled: false, fullWidth: false },
  argTypes: {
    variant: { control: 'select', options: variants },
    size: { control: 'inline-radio', options: sizes },
    iconLeft: { control: false },
    iconRight: { control: false },
    asChild: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const Variantes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {variants.map((v) => (
        <Button key={v} variant={v}>
          {labels[v]}
        </Button>
      ))}
    </div>
  ),
};

export const Tamanhos: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {variants.map((v) => (
        <div key={v} className="flex flex-wrap items-center gap-3">
          {sizes.map((s) => (
            <Button key={s} variant={v} size={s}>
              {labels[v]}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const ComIcones: Story = {
  name: 'Com ícones',
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button iconLeft={<Plus className="size-4" aria-hidden />}>Criar campeonato</Button>
      <Button variant="secondary" iconRight={<ArrowRight className="size-4" aria-hidden />}>
        Próximo passo
      </Button>
      <Button variant="gold" iconLeft={<Trophy className="size-4" aria-hidden />}>
        Ver campeões
      </Button>
      <Button variant="danger" iconLeft={<Trash2 className="size-4" aria-hidden />}>
        Excluir squad
      </Button>
    </div>
  ),
};

export const Carregando: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {variants.map((v) => (
        <Button key={v} variant={v} loading>
          Enviando…
        </Button>
      ))}
    </div>
  ),
};

export const Desabilitado: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {variants.map((v) => (
        <Button key={v} variant={v} disabled>
          {labels[v]}
        </Button>
      ))}
    </div>
  ),
};

export const LarguraTotal: Story = {
  name: 'Largura total',
  args: { fullWidth: true, size: 'lg', children: 'Confirmar inscrição' },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
};

export const ComoLink: Story = {
  name: 'Como link (asChild)',
  render: () => (
    <Button asChild variant="secondary">
      <a href="#regulamento">Abrir regulamento</a>
    </Button>
  ),
};
