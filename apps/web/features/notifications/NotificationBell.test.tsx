import type { Notification } from '@nova/schemas';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { badgeText, bellLabel, NotificationBell } from './NotificationBell';
import { isInternalLink } from './useOpenNotification';

// Testes com muitas interações: folga para quando a máquina está ocupada (CI ou execuções em paralelo).
vi.setConfig({ testTimeout: 30_000 });

const router = { push: vi.fn() };
const state = vi.hoisted(() => ({
  user: { id: 'u_bianca' } as { id: string } | null,
  count: 0,
  recent: { isPending: false, isError: false, data: [] as unknown[], error: null as unknown, refetch: () => undefined },
  markRead: { mutate: (() => undefined) as (id: string) => void },
  markAll: { mutate: () => undefined, isPending: false },
  unreadEnabled: [] as boolean[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/session/useSession', () => ({ useSession: () => ({ user: state.user }) }));
vi.mock('@/shared/api/hooks/notifications', () => ({
  useUnreadCount: (enabled: boolean) => {
    state.unreadEnabled.push(enabled);
    return { data: state.count };
  },
  useRecentNotifications: () => state.recent,
  useMarkNotificationRead: () => state.markRead,
  useMarkAllNotificationsRead: () => state.markAll,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const HOUR = 3600_000;
function notification(patch: Partial<Notification>): Notification {
  return { id: 'n_1', type: 'CHECKIN_OPEN', title: 'Check-in aberto', body: 'Sua partida começa em breve.', link: '/c/liga?aba=partidas', readAt: null, createdAt: new Date(Date.now() - 2 * HOUR).toISOString(), ...patch };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  state.user = { id: 'u_bianca' };
  state.count = 0;
  state.recent = { isPending: false, isError: false, data: [], error: null, refetch: () => undefined };
  state.markRead = { mutate: vi.fn() };
  state.markAll = { mutate: vi.fn(), isPending: false };
  state.unreadEnabled = [];
  router.push.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('texto do sino', () => {
  it('nome acessível com a contagem', () => {
    expect(bellLabel(0)).toBe('Notificações');
    expect(bellLabel(1)).toBe('Notificações, 1 não lida');
    expect(bellLabel(3)).toBe('Notificações, 3 não lidas');
  });
  it('selo: acima de 99 vira 99+', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(120)).toBe('99+');
  });
  it('só navega para caminhos internos', () => {
    expect(isInternalLink('/c/liga')).toBe(true);
    expect(isInternalLink(null)).toBe(false);
    expect(isInternalLink('https://exemplo.com')).toBe(false);
    expect(isInternalLink('//exemplo.com')).toBe(false);
  });
});

describe('NotificationBell', () => {
  it('sem não lidas: o contador some', () => {
    render(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-count')).not.toBeInTheDocument();
  });

  it('com não lidas: mostra o contador e anuncia a quantidade', () => {
    state.count = 3;
    const { rerender } = render(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Notificações, 3 não lidas' })).toBeInTheDocument();
    expect(screen.getByTestId('notification-count')).toHaveTextContent('3');

    // Chegou uma nova (a consulta foi invalidada pelo tempo real): o contador acompanha.
    state.count = 4;
    rerender(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Notificações, 4 não lidas' })).toBeInTheDocument();
    state.count = 150;
    rerender(<NotificationBell />);
    expect(screen.getByTestId('notification-count')).toHaveTextContent('99+');
  });

  it('sem sessão não consulta a API', () => {
    state.user = null;
    render(<NotificationBell />);
    expect(state.unreadEnabled).toEqual([false]);
  });

  it('o painel lista as mais recentes com título, corpo, tempo relativo e marca de não lida', async () => {
    state.count = 1;
    state.recent.data = [notification({ id: 'n_1' }), notification({ id: 'n_2', type: 'REGISTRATION_CONFIRMED', title: 'Inscrição confirmada', body: 'Sua vaga está garantida.', readAt: new Date().toISOString(), createdAt: new Date(Date.now() - 48 * HOUR).toISOString() })];
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notificações, 1 não lida' }));

    const panel = await screen.findByRole('dialog', { name: 'Notificações' });
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Check-in aberto')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('Sua partida começa em breve.')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('há 2 horas')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('Não lida')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('anteontem')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByText('Não lida')).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/notificacoes');
  });

  it('clicar marca como lida, leva ao link e fecha o painel', async () => {
    state.count = 1;
    state.recent.data = [notification({ id: 'n_9', link: '/c/liga?aba=partidas' })];
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /Notificações/ }));
    await user.click(await screen.findByRole('button', { name: /Check-in aberto/ }));
    expect(state.markRead.mutate).toHaveBeenCalledWith('n_9');
    expect(router.push).toHaveBeenCalledWith('/c/liga?aba=partidas');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('notificação já lida e sem link: não marca de novo nem navega', async () => {
    state.recent.data = [notification({ id: 'n_3', readAt: new Date().toISOString(), link: null })];
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    await user.click(await screen.findByRole('button', { name: /Check-in aberto/ }));
    expect(state.markRead.mutate).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('"Marcar todas como lidas" chama a API; fica desligado quando não há o que marcar', async () => {
    state.count = 2;
    state.recent.data = [notification({})];
    const user = userEvent.setup();
    const { rerender } = render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /Notificações/ }));
    await user.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));
    expect(state.markAll.mutate).toHaveBeenCalledTimes(1);

    state.count = 0;
    rerender(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Marcar todas como lidas' })).toBeDisabled();
  });

  it('estados do painel: vazio, carregando e erro com "Tentar novamente"', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(await screen.findByText('Nenhuma notificação por aqui')).toBeInTheDocument();

    state.recent = { ...state.recent, isPending: true };
    rerender(<NotificationBell />);
    expect(screen.getByRole('status', { name: 'Carregando notificações' })).toBeInTheDocument();

    const refetch = vi.fn();
    state.recent = { isPending: false, isError: true, data: [], error: new TypeError('offline'), refetch };
    rerender(<NotificationBell />);
    expect(screen.getByText('Sem conexão. Confira sua internet e tente de novo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalled();
  });
});
