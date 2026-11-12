import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '../test/axe';
import { Badge, StatusPill, statusLabel, type BadgeTone, type Status } from './Badge';

/** Texto esperado de cada status. O `satisfies` obriga a lista a acompanhar o tipo `Status`. */
const labels = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  REGISTRATION_OPEN: 'Inscrições abertas',
  REGISTRATION_CLOSED: 'Inscrições encerradas',
  CHECK_IN: 'Check-in',
  IN_PROGRESS: 'Em andamento',
  LIVE: 'Ao vivo',
  PAUSED: 'Pausado',
  FINISHED: 'Finalizado',
  ARCHIVED: 'Arquivado',
  CANCELLED: 'Cancelado',
  SCHEDULED: 'Agendada',
  AWAITING_VALIDATION: 'Aguardando validação',
  VALIDATED: 'Concluída',
  DISPUTED: 'Em disputa',
  WALKOVER: 'W.O.',
  PENDING: 'Pendente',
  PENDING_MEMBERS: 'Aguardando membros',
  PENDING_APPROVAL: 'Aguardando aprovação',
  CONFIRMED: 'Confirmada',
  WAITLIST: 'Lista de espera',
  REJECTED: 'Recusada',
  WITHDRAWN: 'Desistência',
  DISQUALIFIED: 'Desclassificado',
  ACTIVE: 'Ativo',
  COMPLETED: 'Concluída',
  SUSPENDED: 'Suspenso',
  BANNED: 'Banido',
  ACCEPTED: 'Aceito',
  DECLINED: 'Recusado',
  EXPIRED: 'Expirado',
  REVOKED: 'Revogado',
  OPEN: 'Aberta',
  IN_REVIEW: 'Em análise',
  ESCALATED: 'Escalada',
  RESOLVED: 'Resolvida',
  APPROVED: 'Aprovado',
} satisfies Record<Status, string>;
const statuses = Object.keys(labels) as Status[];

describe('Badge', () => {
  it.each<[BadgeTone, string, string]>([
    ['neutral', 'bg-neutral-soft', 'text-neutral-soft-text'],
    ['primary', 'bg-primary-soft', 'text-primary-soft-text'],
    ['accent', 'bg-accent-soft', 'text-accent-soft-text'],
    ['info', 'bg-info-soft', 'text-info-soft-text'],
    ['warning', 'bg-warning-soft', 'text-warning-soft-text'],
    ['danger', 'bg-danger-soft', 'text-danger-soft-text'],
    ['gold', 'bg-gold-soft', 'text-gold-soft-text'],
  ])('tom %s usa o par %s / %s', (tone, bg, fg) => {
    render(<Badge tone={tone}>Classificado</Badge>);
    expect(screen.getByText('Classificado')).toHaveClass(bg, fg);
  });

  it('é neutro por padrão, mostra o ícone e repassa atributos', () => {
    render(
      <Badge icon={<span data-testid="icone" />} title="Capitão do squad" className="uppercase">
        Capitão
      </Badge>,
    );
    const badge = screen.getByText('Capitão');
    expect(badge).toHaveClass('bg-neutral-soft', 'uppercase');
    expect(badge).toHaveAttribute('title', 'Capitão do squad');
    expect(screen.getByTestId('icone')).toBeInTheDocument();
  });
});

describe('StatusPill', () => {
  it.each(statuses)('%s mostra ícone decorativo + texto (nunca só cor)', (status) => {
    const { container } = render(<StatusPill status={status} />);
    expect(screen.getByText(labels[status])).toBeInTheDocument();
    expect(statusLabel(status)).toBe(labels[status]);
    const icon = container.querySelector('[aria-hidden]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it.each<Status>(['LIVE', 'IN_PROGRESS'])('%s usa o ponto pulsando no lugar do ícone', (status) => {
    const { container } = render(<StatusPill status={status} />);
    expect(container.querySelector('.animate-pulse-live')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('status parado usa ícone, sem animação', () => {
    const { container } = render(<StatusPill status="FINISHED" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse-live')).not.toBeInTheDocument();
  });

  it('label troca o texto padrão', () => {
    render(<StatusPill status="VALIDATED" label="Resultado aprovado" />);
    expect(screen.getByText('Resultado aprovado')).toBeInTheDocument();
    expect(screen.queryByText('Concluída')).not.toBeInTheDocument();
  });

  it('não tem violações de acessibilidade', async () => {
    render(
      <ul>
        {statuses.map((s) => (
          <li key={s}>
            <StatusPill status={s} />
          </li>
        ))}
        <li>
          <Badge tone="gold">Booyah</Badge>
        </li>
      </ul>,
    );
    await expectNoA11yViolations();
  });
});
