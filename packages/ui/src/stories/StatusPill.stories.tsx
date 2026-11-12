import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusPill, type Status } from '../components/Badge';

const groups: Array<{ title: string; statuses: Status[] }> = [
  {
    title: 'Campeonato',
    statuses: ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'LIVE', 'PAUSED', 'FINISHED', 'ARCHIVED', 'CANCELLED'],
  },
  { title: 'Partida e queda', statuses: ['SCHEDULED', 'AWAITING_VALIDATION', 'VALIDATED', 'DISPUTED', 'WALKOVER'] },
  {
    title: 'Inscrição',
    statuses: ['PENDING', 'PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'WITHDRAWN', 'DISQUALIFIED'],
  },
  { title: 'Conta e fase', statuses: ['ACTIVE', 'COMPLETED', 'SUSPENDED', 'BANNED'] },
  { title: 'Convite', statuses: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED'] },
  { title: 'Disputa', statuses: ['OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'APPROVED'] },
];
const all = groups.flatMap((g) => g.statuses);

const meta = {
  title: 'Status/StatusPill',
  component: StatusPill,
  args: { status: 'REGISTRATION_OPEN' },
  argTypes: { status: { control: 'select', options: all } },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const AoVivo: Story = { name: 'Ao vivo (pulsando)', args: { status: 'LIVE' } };

export const TextoTrocado: Story = {
  name: 'Texto trocado',
  args: { status: 'VALIDATED', label: 'Resultado aprovado' },
};

export const TodosOsStatus: Story = {
  name: 'Todos os status',
  render: () => (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted">{g.title}</h3>
          <div className="flex flex-wrap gap-2">
            {g.statuses.map((s) => (
              <StatusPill key={s} status={s} />
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};
