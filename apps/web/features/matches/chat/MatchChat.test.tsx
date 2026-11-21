import type { MatchChat as MatchChatData, MatchChatMessage } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import type { MatchViewer } from '../viewer';
import { canSeeMatchChat, MatchChat } from './MatchChat';

vi.setConfig({ testTimeout: 30_000 });

type Query = { data?: MatchChatData; isPending: boolean; error: unknown; refetch: () => void };
const state = vi.hoisted(() => ({
  query: { isPending: true, error: null, refetch: () => undefined } as Query,
  send: { mutate: (() => undefined) as (input: { body: string }, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => void, isPending: false },
  hide: { mutate: (() => undefined) as (id: string, opts?: unknown) => void, isPending: false, variables: undefined as string | undefined },
}));

vi.mock('@/shared/api/hooks/chat', () => ({ useMatchChat: () => state.query, useSendChatMessage: () => state.send, useHideChatMessage: () => state.hide }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/c/liga' }));
vi.mock('@/shared/session/useSession', () => ({ useSession: () => ({ user: { id: 'u_bianca' }, isLoading: false }) }));

const match = { id: 'm1', participants: [{ registrationId: 'r_bianca' }, { registrationId: 'r_lucas' }] } as never;
const player: MatchViewer = { userId: 'u_bianca', registration: { id: 'r_bianca' } as never, checkIn: null };
const staff: MatchViewer = { userId: 'u_camila', registration: null, checkIn: null, isStaff: true };

const msg = (over: Partial<MatchChatMessage>): MatchChatMessage => ({
  id: 'c1',
  matchId: 'm1',
  authorId: 'u_lucas',
  authorNickname: 'Lucas',
  authorAvatarUrl: null,
  authorRole: 'PLAYER',
  body: 'Bora às 20h?',
  hidden: false,
  createdAt: new Date().toISOString(),
  ...over,
});

function renderChat(viewer: MatchViewer = player) {
  return render(
    <ToastProvider>
      <MatchChat match={match} viewer={viewer} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  state.query = { isPending: false, error: null, refetch: vi.fn(), data: { messages: [], canPost: true, canModerate: false, closedReason: null } };
  state.send = { mutate: vi.fn(), isPending: false };
  state.hide = { mutate: vi.fn(), isPending: false, variables: undefined };
});

describe('MatchChat', () => {
  it('só aparece para quem joga a partida ou é da organização', () => {
    expect(canSeeMatchChat(match, player)).toBe(true);
    expect(canSeeMatchChat(match, staff)).toBe(true);
    expect(canSeeMatchChat(match, { userId: 'u_x', registration: { id: 'r_x' } as never, checkIn: null })).toBe(false);
    expect(canSeeMatchChat(match, { userId: null, registration: null, checkIn: null })).toBe(false);
    renderChat({ userId: 'u_x', registration: null, checkIn: null });
    expect(screen.queryByTestId('match-chat')).not.toBeInTheDocument();
  });

  it('carregando, vazio e erro', async () => {
    state.query = { isPending: true, error: null, refetch: vi.fn() };
    const { unmount } = renderChat();
    expect(screen.getByRole('status', { name: 'Carregando o chat' })).toBeInTheDocument();
    unmount();
    state.query = { isPending: false, error: null, refetch: vi.fn(), data: { messages: [], canPost: true, canModerate: false, closedReason: null } };
    const second = renderChat();
    expect(screen.getByText(/Nenhuma mensagem ainda/)).toBeInTheDocument();
    second.unmount();
    const refetch = vi.fn();
    state.query = { isPending: false, error: new TypeError('rede'), refetch };
    renderChat();
    await userEvent.setup().click(screen.getByRole('button', { name: /Tentar novamente/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('envia com Enter (Shift+Enter quebra a linha) e limpa o campo', async () => {
    const user = userEvent.setup();
    state.send.mutate = vi.fn((_input, opts) => opts?.onSuccess?.());
    renderChat();
    const field = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.type(field, 'Oi{Shift>}{Enter}{/Shift}tudo bem?');
    expect(field).toHaveValue('Oi\ntudo bem?');
    await user.keyboard('{Enter}');
    expect(state.send.mutate).toHaveBeenCalledWith({ body: 'Oi\ntudo bem?' }, expect.anything());
    expect(field).toHaveValue('');
  });

  it('mensagem vazia mostra o erro no campo; erro da API vai para o campo', async () => {
    const user = userEvent.setup();
    state.send.mutate = vi.fn((_input, opts) => opts?.onError?.(new ApiError({ type: 'about:blank', title: 'x', status: 400, errors: { body: 'Use até 500 caracteres' } })));
    renderChat();
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByText('Escreva a mensagem')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByText('Use até 500 caracteres')).toBeInTheDocument();
  });

  it('lista as mensagens com a organização identificada por texto, denúncia e ocultar', async () => {
    const user = userEvent.setup();
    state.query.data = {
      canPost: true,
      canModerate: true,
      closedReason: null,
      messages: [msg({}), msg({ id: 'c2', authorId: 'u_camila', authorNickname: 'Camila', authorRole: 'STAFF', body: 'Sala 15 min antes.' }), msg({ id: 'c3', body: 'texto ruim', hidden: true })],
    };
    renderChat(staff);
    const log = screen.getByRole('log', { name: 'Mensagens do chat' });
    const items = within(log).getAllByTestId('chat-message');
    expect(items).toHaveLength(3);
    expect(within(items[1] as HTMLElement).getByText('Organização')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('Você')).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText('Oculta para os jogadores')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Denunciar a mensagem de Lucas' })).toBeInTheDocument();
    await user.click(within(items[0] as HTMLElement).getByRole('button', { name: 'Ocultar a mensagem de Lucas' }));
    expect(state.hide.mutate).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('jogador vê o aviso de mensagem ocultada; chat fechado fica só para leitura', () => {
    state.query.data = { canPost: false, canModerate: false, closedReason: 'O campeonato não está em andamento: o chat fica só para leitura.', messages: [msg({ hidden: true, body: '' })] };
    renderChat();
    expect(screen.getByText('Mensagem ocultada pela organização.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Mensagem' })).not.toBeInTheDocument();
    expect(screen.getByText(/só para leitura/)).toBeInTheDocument();
  });

  it('403 da API: o chat não aparece', () => {
    state.query = { isPending: false, error: new ApiError({ type: 'about:blank', title: 'Proibido', status: 403 }), refetch: vi.fn() };
    renderChat();
    expect(screen.queryByTestId('match-chat')).not.toBeInTheDocument();
  });
});
