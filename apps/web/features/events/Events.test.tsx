import type { Event, EventDetail, OrganizerTournament, TournamentSummary } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventForm } from './EventForm';
import { EventPage } from './EventPage';
import { TournamentEventNote } from './EventRule';
import { ManageEventPage, OrganizerEventsPage } from './OrganizerEvents';

type Query<T> = { isPending: boolean; isError: boolean; isSuccess: boolean; data: T | undefined; error: unknown; refetch: () => void };
const ok = <T,>(data: T): Query<T> => ({ isPending: false, isError: false, isSuccess: true, data, error: null, refetch: () => undefined });
const pending = <T,>(): Query<T> => ({ isPending: true, isError: false, isSuccess: false, data: undefined, error: null, refetch: () => undefined });
const failed = <T,>(error: unknown): Query<T> => ({ isPending: false, isError: true, isSuccess: false, data: undefined, error, refetch: () => undefined });

const state = vi.hoisted(() => ({
  event: null as unknown,
  mine: null as unknown,
  managed: null as unknown,
  tournaments: null as unknown,
  added: [] as string[],
  updated: [] as unknown[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const mutation = (onCall: (v: unknown) => void) => ({ isPending: false, variables: undefined, mutate: (v: unknown, opts?: { onSuccess?: () => void }) => (onCall(v), opts?.onSuccess?.()), mutateAsync: async (v: unknown) => (onCall(v), v) });
vi.mock('@/shared/api/hooks/events', () => ({
  useEvent: () => state.event,
  useMyEvents: () => state.mine,
  useManagedEvent: () => state.managed,
  useCreateEvent: () => mutation(() => undefined),
  useUpdateEvent: () => mutation((v) => state.updated.push(v)),
  useDeleteEvent: () => mutation(() => undefined),
  useAddEventTournament: () => mutation((v) => state.added.push(v as string)),
  useRemoveEventTournament: () => mutation(() => undefined),
}));
vi.mock('@/shared/api/hooks/organizer', () => ({ useOrganizerTournaments: () => state.tournaments }));

const T: TournamentSummary = {
  id: 't1',
  slug: 'copa-squad',
  name: 'Copa Squad',
  gameId: 'g',
  gameModeId: 'm',
  ownerId: 'u1',
  status: 'REGISTRATION_OPEN',
  participantType: 'TEAM',
  maxParticipants: 16,
  registrationOpensAt: null,
  registrationClosesAt: null,
  startsAt: '2026-12-01T20:00:00.000Z',
  bannerUrl: null,
  featured: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  gameName: 'Free Fire',
  gameIcon: '🔥',
  modeName: 'Squad',
  organizerNickname: 'Camila',
  organizerVerified: true,
  takenSlots: 3,
  free: true,
};
const EVENT: Event = {
  id: 'ev1',
  slug: 'festival',
  name: 'Festival Free Fire',
  description: 'Um fim de semana de Free Fire.',
  bannerUrl: null,
  participationRule: 'SINGLE',
  owner: { id: 'u1', nickname: 'Camila' },
  tournamentCount: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};
const DETAIL: EventDetail = { ...EVENT, tournaments: [T] };
const FREE: OrganizerTournament = { ...T, id: 't2', name: 'Copa Solo', status: 'DRAFT', access: 'OWNER', draftStep: 1, pendingApprovals: 0, waitlistCount: 0, stageCount: 1, eventId: null };
const RUNNING: OrganizerTournament = { ...FREE, id: 't3', name: 'Copa Rolando', status: 'IN_PROGRESS' };
const ELSEWHERE: OrganizerTournament = { ...FREE, id: 't4', name: 'Copa de Outro Evento', eventId: 'ev2' };

const withToast = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  state.event = ok(DETAIL);
  state.mine = ok([EVENT]);
  state.managed = ok(DETAIL);
  state.tournaments = ok([FREE, RUNNING, ELSEWHERE]);
  state.added = [];
  state.updated = [];
});

describe('página pública do evento', () => {
  it('mostra o nome, a regra em palavras simples e os campeonatos', () => {
    render(<EventPage slug="festival" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Festival Free Fire' })).toBeInTheDocument();
    expect(screen.getByText('Cada jogador pode participar de um só campeonato deste evento.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Copa Squad/ })).toHaveAttribute('href', '/c/copa-squad');
    expect(screen.getByRole('link', { name: 'Camila' })).toHaveAttribute('href', '/u/Camila');
  });

  it('regra MULTIPLE, carregando, não encontrado e erro', async () => {
    state.event = ok({ ...DETAIL, participationRule: 'MULTIPLE' });
    const { rerender } = render(<EventPage slug="festival" />);
    expect(screen.getByText('Você pode participar de vários campeonatos deste evento.')).toBeInTheDocument();
    state.event = pending();
    rerender(<EventPage slug="festival" />);
    expect(screen.getByRole('status', { name: 'Carregando o evento' })).toBeInTheDocument();
    const { ApiError } = await import('@/shared/api/client');
    state.event = failed(new ApiError({ status: 404, title: 'Evento não encontrado.', type: 'about:blank' } as never));
    rerender(<EventPage slug="festival" />);
    expect(screen.getByText('Evento não encontrado')).toBeInTheDocument();
    state.event = failed(new Error('rede'));
    rerender(<EventPage slug="festival" />);
    expect(screen.getByText('Não foi possível carregar o evento')).toBeInTheDocument();
  });
});

describe('selo do evento na página do campeonato', () => {
  it('liga para o evento e explica a regra', () => {
    render(<TournamentEventNote event={{ id: 'ev1', slug: 'festival', name: 'Festival Free Fire', participationRule: 'SINGLE' }} />);
    expect(screen.getByRole('link', { name: 'Festival Free Fire' })).toHaveAttribute('href', '/e/festival');
    expect(screen.getByText(/Faz parte do evento/)).toBeInTheDocument();
    expect(screen.getByText('Cada jogador pode participar de um só campeonato deste evento.')).toBeInTheDocument();
  });
});

describe('formulário do evento', () => {
  it('a regra é um grupo de opções com explicação; envia os valores escolhidos', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<EventForm submitLabel="Criar evento" onSubmit={onSubmit} />);
    const group = screen.getByRole('group', { name: 'Quem pode participar de quê' });
    const single = within(group).getByRole('radio', { name: 'Um só campeonato por jogador' });
    expect(within(group).getByRole('radio', { name: 'Vários campeonatos por jogador' })).toBeChecked();
    expect(single).toHaveAccessibleDescription(/não consegue se inscrever em outro/);
    fireEvent.click(single);
    fireEvent.change(screen.getByLabelText(/Nome do evento/), { target: { value: '  Festival de Verão ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Festival de Verão', description: '', participationRule: 'SINGLE' }));
  });

  it('nome curto não é enviado', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<EventForm submitLabel="Criar evento" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Nome do evento/), { target: { value: 'Ev' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByText('Dê um nome ao evento (de 3 a 80 caracteres)')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('área do organizador', () => {
  it('lista os eventos com a regra; vazio convida a criar o primeiro', () => {
    const { rerender } = render(<OrganizerEventsPage />);
    expect(screen.getByRole('link', { name: 'Festival Free Fire' })).toHaveAttribute('href', '/organizador/eventos/ev1');
    expect(screen.getByText('Um campeonato por jogador')).toBeInTheDocument();
    expect(screen.getByText('1 campeonato')).toBeInTheDocument();
    state.mine = ok([]);
    rerender(<OrganizerEventsPage />);
    expect(screen.getByRole('link', { name: 'Criar o primeiro evento' })).toHaveAttribute('href', '/organizador/eventos/novo');
  });

  it('gerenciar: criar campeonato no evento, adicionar só os livres e ainda não começados', async () => {
    withToast(<ManageEventPage id="ev1" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Festival Free Fire' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Criar campeonato neste evento' })).toHaveAttribute('href', '/organizador/novo?evento=ev1');
    expect(screen.getByRole('link', { name: 'Ver página pública' })).toHaveAttribute('href', '/e/festival');
    const select = screen.getByLabelText('Adicionar campeonato existente');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith('Copa Solo'))).toBe(true);
    expect(options.some((o) => o?.startsWith('Copa Rolando'))).toBe(false);
    expect(options.some((o) => o?.startsWith('Copa de Outro Evento'))).toBe(false);
    fireEvent.change(select, { target: { value: 't2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(state.added).toEqual(['t2']));
    expect(screen.getByRole('button', { name: 'Tirar do evento o campeonato Copa Squad' })).toBeInTheDocument();
  });

  it('gerenciar: trocar a regra salva o evento', async () => {
    withToast(<ManageEventPage id="ev1" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Vários campeonatos por jogador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(state.updated).toEqual([{ name: 'Festival Free Fire', description: 'Um fim de semana de Free Fire.', participationRule: 'MULTIPLE' }]));
  });
});
