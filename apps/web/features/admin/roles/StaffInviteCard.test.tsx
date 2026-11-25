/** A administração gera link para a equipe de um campeonato (co-organizador ou moderador), ao lado dos convites de papel. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffInviteCard } from './StaffInviteCard';

const state = vi.hoisted(() => ({ mutate: vi.fn(), tournamentId: '' }));

vi.mock('@/shared/api/hooks/admin-tournaments', () => ({
  useAdminTournaments: () => ({
    isPending: false,
    isError: false,
    data: {
      items: [
        { id: 'tn_aberto', name: 'Copa Aberta', status: 'REGISTRATION_OPEN', ownerNickname: 'Camila' },
        { id: 'tn_fim', name: 'Copa Encerrada', status: 'FINISHED', ownerNickname: 'Diego' },
      ],
    },
  }),
}));
vi.mock('@/shared/api/hooks/organizer-ops', () => ({
  useCreateStaffInvite: (id: string) => {
    state.tournamentId = id;
    return { mutate: state.mutate, isPending: false };
  },
}));

describe('StaffInviteCard', () => {
  beforeEach(() => state.mutate.mockReset());

  it('lista só os campeonatos que ainda aceitam equipe', () => {
    render(<StaffInviteCard />);
    expect(screen.getByRole('option', { name: 'Copa Aberta · de Camila' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Copa Encerrada/ })).toBeNull();
  });

  it('pede o campeonato antes de gerar', async () => {
    render(<StaffInviteCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link da equipe' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o campeonato do convite.');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('gera o link de moderador do campeonato escolhido e mostra para copiar', async () => {
    state.mutate.mockImplementation((_v?: unknown, o?: { onSuccess?: (i: unknown) => void }) =>
      o?.onSuccess?.({ id: 'i1', link: 'https://novaarena.gg/equipe/convite/abc', expiresAt: '2026-11-26T12:00:00.000Z', role: 'MODERATOR' }),
    );
    render(<StaffInviteCard />);
    await userEvent.selectOptions(screen.getByLabelText('Campeonato'), 'tn_aberto');
    await userEvent.selectOptions(screen.getByLabelText('Papel'), 'MODERATOR');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar link da equipe' }));
    expect(state.tournamentId).toBe('tn_aberto');
    expect(state.mutate).toHaveBeenCalledWith({ role: 'MODERATOR', validity: '24h', maxUses: 1 }, expect.anything());
    expect(await screen.findByText('https://novaarena.gg/equipe/convite/abc')).toBeVisible();
  });
});
