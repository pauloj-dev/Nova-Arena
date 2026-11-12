import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusPill } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, Progress } from '../components/Surface';
import { tournament } from './fixtures';

const meta = {
  title: 'Conteúdo/Card',
  component: Card,
  args: { padding: 'md', interactive: false },
  argTypes: { padding: { control: 'inline-radio', options: ['none', 'sm', 'md'] } },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

function TournamentSummary() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg text-text">{tournament.name}</h3>
          <p className="text-sm text-muted">
            {tournament.game} · {tournament.mode}
          </p>
        </div>
        <StatusPill status="REGISTRATION_OPEN" />
      </div>
      <Progress value={tournament.registered} max={tournament.slots} label="Vagas preenchidas" />
      <p className="text-sm text-muted">
        Começa {tournament.startsAt} · Premiação de <span className="tabular text-text">{tournament.prize}</span>
      </p>
    </div>
  );
}

export const Padrao: Story = {
  name: 'Padrão',
  render: (args) => (
    <Card {...args}>
      <TournamentSummary />
    </Card>
  ),
};

export const Compacto: Story = {
  args: { padding: 'sm' },
  render: (args) => (
    <Card {...args}>
      <p className="text-sm text-text">Queda 3 de 6 · Bermuda</p>
      <p className="text-xs text-muted">Sala abre às 20h15. A senha aparece aqui 10 minutos antes.</p>
    </Card>
  ),
};

export const SemPadding: Story = {
  name: 'Sem padding',
  args: { padding: 'none' },
  render: (args) => (
    <Card {...args} className="overflow-hidden">
      <div className="bg-hero px-4 py-6 text-white">
        <p className="font-display text-xl font-bold">{tournament.name}</p>
      </div>
      <div className="p-4">
        <TournamentSummary />
      </div>
    </Card>
  ),
};

export const Interativo: Story = {
  args: { interactive: true },
  render: (args) => (
    <Card {...args}>
      <div className="flex flex-col gap-4">
        <TournamentSummary />
        <Button fullWidth>Inscrever squad</Button>
      </div>
    </Card>
  ),
};
