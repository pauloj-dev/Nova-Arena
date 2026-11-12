import type { Meta, StoryObj } from '@storybook/react-vite';
import { Crown, ShieldCheck, Users } from 'lucide-react';
import { Badge, type BadgeTone } from '../components/Badge';

const tones: Array<{ tone: BadgeTone; label: string }> = [
  { tone: 'neutral', label: 'Reserva' },
  { tone: 'primary', label: 'Classificado' },
  { tone: 'accent', label: 'Seu squad' },
  { tone: 'info', label: 'Vagas abertas' },
  { tone: 'warning', label: 'Check-in pendente' },
  { tone: 'danger', label: 'Eliminado' },
  { tone: 'gold', label: 'Booyah' },
];

const meta = {
  title: 'Status/Badge',
  component: Badge,
  args: { children: 'Classificado', tone: 'primary' },
  argTypes: { tone: { control: 'select', options: tones.map((t) => t.tone) }, icon: { control: false } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const Tons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {tones.map((t) => (
        <Badge key={t.tone} tone={t.tone}>
          {t.label}
        </Badge>
      ))}
    </div>
  ),
};

export const ComIcone: Story = {
  name: 'Com ícone',
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
        Capitão
      </Badge>
      <Badge tone="primary" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
        Organizador verificado
      </Badge>
      <Badge tone="neutral" icon={<Users className="size-3.5" aria-hidden />}>
        37/48 squads
      </Badge>
    </div>
  ),
};
