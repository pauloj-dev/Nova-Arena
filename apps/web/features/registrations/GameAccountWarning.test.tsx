/** Falta o ID do jogo: o jogador informa no próprio painel do campeonato, sem ir para Minha conta. */
import { ToastProvider } from '@nova/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAccountWarning } from './GameAccountWarning';

const state = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@/shared/api/hooks/games', () => ({
  useGame: () => ({
    isPending: false,
    data: {
      id: 'g_ff',
      requiredAccountFields: [
        { key: 'playerId', label: 'ID Free Fire', placeholder: 'Ex.: 1234567890', pattern: '^[0-9]{6,12}$' },
        { key: 'nick', label: 'Nick no jogo', placeholder: 'Como aparece na partida' },
      ],
    },
  }),
}));
vi.mock('@/shared/api/hooks/users', () => ({ useUpsertGameAccount: () => ({ mutate: state.mutate, isPending: false }) }));

function renderWarning(context: 'register' | 'confirm') {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <GameAccountWarning gameId="g_ff" gameName="Free Fire" context={context} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('GameAccountWarning', () => {
  beforeEach(() => state.mutate.mockReset());

  it('mostra os campos do jogo ali mesmo, sem mandar para Minha conta', () => {
    renderWarning('register');
    expect(screen.getByText('Falta o seu ID de Free Fire.')).toBeVisible();
    expect(screen.getByLabelText('ID Free Fire')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('Nick no jogo')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Minha conta/ })).toBeNull();
  });

  it('confere o formato antes de salvar', async () => {
    renderWarning('register');
    await userEvent.type(screen.getByLabelText('ID Free Fire'), '12');
    await userEvent.type(screen.getByLabelText('Nick no jogo'), 'CapNovo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar meu ID de Free Fire' }));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('salva o ID e avisa o próximo passo', async () => {
    state.mutate.mockImplementation((_v?: unknown, o?: { onSuccess?: () => void }) => o?.onSuccess?.());
    renderWarning('confirm');
    await userEvent.type(screen.getByLabelText('ID Free Fire'), '12345678');
    await userEvent.type(screen.getByLabelText('Nick no jogo'), 'CapNovo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar meu ID de Free Fire' }));
    expect(state.mutate).toHaveBeenCalledWith({ gameId: 'g_ff', fields: { playerId: '12345678', nick: 'CapNovo' } }, expect.anything());
    expect(await screen.findByText('Agora é só confirmar sua participação.')).toBeVisible();
  });
});
