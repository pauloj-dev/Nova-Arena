import type { CreateStaffInviteInput, OrganizerTournamentDetail, TournamentStaffInvite } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReopenRegistrationDialog } from './ReopenRegistrationDialog';
import { StaffInviteLinks } from './StaffInviteLinks';

vi.setConfig({ testTimeout: 30_000 });

type Opts<T> = { onSuccess?: (v: T) => void; onError?: (e: unknown) => void };
const state = vi.hoisted(() => ({
  list: { isPending: false, isError: false, error: null as unknown, refetch: () => undefined, data: [] as TournamentStaffInvite[] },
  create: { mutate: (() => undefined) as (input: CreateStaffInviteInput, o?: Opts<TournamentStaffInvite>) => void, isPending: false },
  revoke: { mutate: (() => undefined) as (id: string, o?: Opts<TournamentStaffInvite>) => void, isPending: false, variables: undefined as string | undefined },
  open: { mutate: (() => undefined) as (input: { id: string; registrationClosesAt?: string }, o?: Opts<unknown>) => void, isPending: false, isError: false, error: null as unknown, reset: () => undefined },
}));

vi.mock('@/shared/api/hooks/organizer-ops', () => ({
  useStaffInvites: () => state.list,
  useCreateStaffInvite: () => state.create,
  useRevokeStaffInvite: () => state.revoke,
}));
vi.mock('@/shared/api/hooks/organizer', () => ({ useOpenRegistration: () => state.open }));

const invite = (over: Partial<TournamentStaffInvite> = {}): TournamentStaffInvite => ({
  id: 'si_1',
  tournamentId: 't1',
  role: 'MODERATOR',
  link: null,
  maxUses: 3,
  uses: 1,
  state: 'VALID',
  createdByNickname: 'Camila',
  createdAt: '2026-11-24T12:00:00.000Z',
  expiresAt: '2026-11-25T12:00:00.000Z',
  ...over,
});

const roleOptions = [
  { value: 'MODERATOR' as const, label: 'Moderador' },
  { value: 'CO_ORGANIZER' as const, label: 'Co-organizador' },
];

beforeEach(() => {
  state.list = { isPending: false, isError: false, error: null, refetch: vi.fn(), data: [] };
  state.create = { mutate: vi.fn(), isPending: false };
  state.revoke = { mutate: vi.fn(), isPending: false, variables: undefined };
  state.open = { mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() };
});
afterEach(() => cleanup());

describe('StaffInviteLinks', () => {
  it('gera o link com o papel, a validade e os usos escolhidos e mostra o link para copiar', async () => {
    const created = invite({ id: 'si_new', role: 'CO_ORGANIZER', link: 'https://novaarena.gg/equipe/convite/abc', uses: 0, maxUses: 5 });
    state.create.mutate = vi.fn((_input: CreateStaffInviteInput, o?: Opts<TournamentStaffInvite>) => o?.onSuccess?.(created));
    render(
      <ToastProvider>
        <StaffInviteLinks tournamentId="t1" roleOptions={roleOptions} />
      </ToastProvider>,
    );
    expect(screen.getByText('Nenhum link ativo no momento.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Papel'), 'CO_ORGANIZER');
    await userEvent.selectOptions(screen.getByLabelText('Validade'), '7d');
    await userEvent.selectOptions(screen.getByLabelText('Quantas pessoas podem usar'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link' }));
    expect(state.create.mutate).toHaveBeenCalledWith({ role: 'CO_ORGANIZER', validity: '7d', maxUses: 5 }, expect.anything());
    expect(screen.getByLabelText('Link do convite')).toHaveValue('https://novaarena.gg/equipe/convite/abc');
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument();
  });

  it('lista só os links ativos e revoga', async () => {
    state.list.data = [invite(), invite({ id: 'si_old', state: 'EXPIRED' })];
    render(
      <ToastProvider>
        <StaffInviteLinks tournamentId="t1" roleOptions={roleOptions} />
      </ToastProvider>,
    );
    const items = screen.getAllByTestId('staff-invite');
    expect(items).toHaveLength(1);
    expect(within(items[0] as HTMLElement).getByText('Moderador · 1 de 3 usos')).toBeInTheDocument();
    await userEvent.click(within(items[0] as HTMLElement).getByRole('button', { name: /Revogar o link de moderador/ }));
    expect(state.revoke.mutate).toHaveBeenCalledWith('si_1', expect.anything());
  });
});

describe('ReopenRegistrationDialog', () => {
  const tournament = { id: 't1' } as OrganizerTournamentDetail;

  it('pede a nova data de fechamento antes de reabrir', async () => {
    render(
      <ToastProvider>
        <ReopenRegistrationDialog tournament={tournament} open onOpenChange={() => undefined} />
      </ToastProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Reabrir as inscrições?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir inscrições' }));
    expect(screen.getByText('Escolha quando as inscrições vão fechar.')).toBeInTheDocument();
    expect(state.open.mutate).not.toHaveBeenCalled();
  });

  it('com a data, reabre mandando o fechamento novo', async () => {
    const onOpenChange = vi.fn();
    state.open.mutate = vi.fn((_input, o?: Opts<unknown>) => o?.onSuccess?.(undefined));
    render(
      <ToastProvider>
        <ReopenRegistrationDialog tournament={tournament} open onOpenChange={onOpenChange} />
      </ToastProvider>,
    );
    const field = screen.getByLabelText(/Novo fechamento das inscrições/);
    await userEvent.type(field, '2030-01-10T20:30');
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir inscrições' }));
    expect(state.open.mutate).toHaveBeenCalledWith({ id: 't1', registrationClosesAt: expect.stringMatching(/^2030-01-1\dT/) }, expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
