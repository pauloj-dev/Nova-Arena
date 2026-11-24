import type { StaffInvitePreview } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { StaffInviteScreen } from './StaffInviteScreen';

type Opts = { onSuccess?: (v: { tournamentId: string; slug: string; role: 'MODERATOR' | 'CO_ORGANIZER' }) => void };
const router = { replace: vi.fn(), push: vi.fn() };
const state = vi.hoisted(() => ({
  invite: { isPending: false, isError: false, error: null as unknown, isRefetching: false, refetch: () => undefined, data: undefined as StaffInvitePreview | undefined },
  accept: { mutate: (() => undefined) as (token: string, o?: Opts) => void, isPending: false, isError: false, isSuccess: false, error: null as unknown, data: undefined as unknown },
  session: { user: null as null | { nickname: string; email: string; emailVerified: boolean }, isLoading: false },
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/session/useSession', () => ({ useSession: () => state.session }));
vi.mock('@/shared/api/hooks/organizer-ops', () => ({
  useStaffInvite: () => state.invite,
  useAcceptStaffInvite: () => state.accept,
}));

const preview: StaffInvitePreview = {
  tournament: { id: 'tn_1', slug: 'copa-teste', name: 'Copa Teste', gameName: 'Free Fire' },
  role: 'MODERATOR',
  state: 'VALID',
  invitedBy: 'Camila',
  expiresAt: '2026-12-01T12:00:00.000Z',
};

const renderScreen = () =>
  render(
    <ToastProvider>
      <StaffInviteScreen token="abc123abc123" />
    </ToastProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.invite = { isPending: false, isError: false, error: null, isRefetching: false, refetch: vi.fn(), data: preview };
  state.accept = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, data: undefined };
  state.session = { user: null, isLoading: false };
});
afterEach(() => cleanup());

describe('StaffInviteScreen', () => {
  it('visitante vê o campeonato, o papel e entra pela conta voltando para o convite', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Convite para a equipe do campeonato' })).toBeInTheDocument();
    expect(screen.getByText('Camila convidou você para ser moderador de Copa Teste.')).toBeInTheDocument();
    expect(screen.getByText(/Free Fire/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', `/entrar?next=${encodeURIComponent('/equipe/convite/abc123abc123')}`);
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', `/cadastro?next=${encodeURIComponent('/equipe/convite/abc123abc123')}`);
  });

  it('logado: aceita e vai para a gestão do campeonato', async () => {
    state.session = { user: { nickname: 'Lucas', email: 'lucas@exemplo.com', emailVerified: true }, isLoading: false };
    state.accept.mutate = vi.fn((_token: string, o?: Opts) => o?.onSuccess?.({ tournamentId: 'tn_1', slug: 'copa-teste', role: 'MODERATOR' }));
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar e entrar na equipe' }));
    expect(state.accept.mutate).toHaveBeenCalledWith('abc123abc123', expect.anything());
    expect(router.replace).toHaveBeenCalledWith('/organizador/campeonatos/tn_1');
  });

  it('e-mail não confirmado: pede a confirmação antes de aceitar', () => {
    state.session = { user: { nickname: 'Lucas', email: 'lucas@exemplo.com', emailVerified: false }, isLoading: false };
    renderScreen();
    expect(screen.queryByRole('button', { name: 'Aceitar e entrar na equipe' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Confirmar meu e-mail' })).toBeInTheDocument();
  });

  it('link esgotado: explica e não oferece o aceite', () => {
    state.invite.data = { ...preview, state: 'EXHAUSTED' };
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Este convite já foi usado' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceitar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver o campeonato' })).toHaveAttribute('href', '/c/copa-teste');
  });

  it('link inexistente: convite não encontrado', () => {
    state.invite = { ...state.invite, data: undefined, isError: true, error: new ApiError({ type: 'about:blank', status: 404, title: 'Convite não encontrado.' }) };
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Convite não encontrado' })).toBeInTheDocument();
  });

  it('aceite recusado pela API (ex.: inscrito no campeonato): mostra o motivo', () => {
    state.session = { user: { nickname: 'Lucas', email: 'lucas@exemplo.com', emailVerified: true }, isLoading: false };
    state.accept = { ...state.accept, isError: true, error: new ApiError({ type: 'about:blank', status: 409, title: 'Você está inscrito neste campeonato. Quem joga não pode fazer parte da equipe do evento.' }) };
    renderScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Você está inscrito neste campeonato');
  });
});
