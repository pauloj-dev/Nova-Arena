import type { Dispute, ResultSubmission } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisputeList } from './DisputeList';
import { ValidationQueue } from './ValidationQueue';

// Testes com muitas interações: folga para quando a máquina está ocupada (CI ou execuções em paralelo).
vi.setConfig({ testTimeout: 30_000 });

const state = vi.hoisted(() => ({
  queue: { isPending: false, isError: false, data: [] as unknown[], error: null as unknown, refetch: () => undefined },
  disputes: { isPending: false, isError: false, data: [] as unknown[], error: null as unknown, refetch: () => undefined },
  matches: { data: undefined as unknown },
  review: { mutate: (() => undefined) as (input: unknown, opts?: unknown) => void, isPending: false },
  queueArgs: [] as unknown[],
  channels: [] as (string | null)[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/api/hooks/disputes', () => ({
  useTournamentSubmissions: (...args: unknown[]) => {
    state.queueArgs.push(args);
    return state.queue;
  },
  useTournamentDisputes: () => state.disputes,
  useReviewSubmission: () => state.review,
}));
vi.mock('@/shared/api/hooks/competition', () => ({ useTournamentMatches: () => state.matches }));
vi.mock('./useLiveResultQueues', () => ({ useLiveResultQueues: (id: string | null) => void state.channels.push(id) }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type MutateOptions = { onSuccess?: () => void; onError?: (e: unknown) => void; onSettled?: () => void };

function submission(patch: Partial<ResultSubmission> = {}): ResultSubmission {
  return {
    id: 'sub_1',
    matchId: 's1~m1',
    tournamentId: 'tn_1',
    tournamentName: 'Liga',
    matchLabel: 'Quartas de final: Bianca x Caio',
    submittedByNickname: 'Bianca',
    submittedByRegistrationId: 'r_bianca',
    entries: [
      { registrationId: 'r_bianca', score: 2 },
      { registrationId: 'r_caio', score: 1 },
    ],
    winnerRegistrationId: 'r_bianca',
    evidenceUrls: ['data:image/jpeg;base64,PRINT1', 'data:image/jpeg;base64,PRINT2'],
    status: 'CONFIRMED',
    createdAt: '2026-11-12T20:00:00.000Z',
    respondBy: '2026-11-12T20:30:00.000Z',
    ...patch,
  };
}

function dispute(patch: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dp_1',
    matchId: 's1~m1',
    submissionId: 'sub_1',
    tournamentId: 'tn_1',
    tournamentName: 'Liga',
    matchLabel: 'Quartas de final: Bianca x Caio',
    openedByNickname: 'Caio',
    reason: 'O placar real foi 2 a 0 para mim.',
    status: 'OPEN',
    resolution: null,
    messages: [],
    createdAt: '2026-11-12T20:10:00.000Z',
    resolvedAt: null,
    ...patch,
  };
}

const wrap = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  state.queue = { isPending: false, isError: false, data: [], error: null, refetch: () => undefined };
  state.disputes = { isPending: false, isError: false, data: [], error: null, refetch: () => undefined };
  state.matches = { data: [{ id: 's1~m1', participants: [{ registrationId: 'r_bianca', name: 'Bianca' }, { registrationId: 'r_caio', name: 'Caio' }] }] };
  state.review = { mutate: vi.fn(), isPending: false };
  state.queueArgs = [];
  state.channels = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('ValidationQueue', () => {
  it('pede a fila do campeonato e acompanha o canal dele', () => {
    wrap(<ValidationQueue tournamentId="tn_1" />);
    expect(state.queueArgs[0]).toEqual(['tn_1']);
    expect(state.channels).toEqual(['tn_1']);
    expect(screen.getByRole('heading', { level: 2, name: 'Resultados para validar' })).toBeInTheDocument();
  });

  it('estados: carregando, vazio e erro com "Tentar novamente"', async () => {
    state.queue = { ...state.queue, isPending: true };
    const { rerender } = wrap(<ValidationQueue tournamentId="tn_1" />);
    expect(screen.getByRole('status', { name: 'Carregando resultados para validar' })).toBeInTheDocument();

    state.queue = { ...state.queue, isPending: false, data: [] };
    rerender(
      <ToastProvider>
        <ValidationQueue tournamentId="tn_1" />
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Nenhum resultado para validar' })).toBeInTheDocument();

    const refetch = vi.fn();
    state.queue = { isPending: false, isError: true, data: [], error: new TypeError('offline'), refetch };
    rerender(
      <ToastProvider>
        <ValidationQueue tournamentId="tn_1" />
      </ToastProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('mostra placar com os nomes, quem enviou, a situação e abre as provas', async () => {
    state.queue.data = [submission(), submission({ id: 'sub_2', matchId: 's1~m2', matchLabel: 'Quartas de final: Dani x Edu', status: 'PENDING', submittedByNickname: 'Dani', entries: [{ registrationId: 'r_dani', score: 0 }, { registrationId: 'r_edu', score: 2 }], winnerRegistrationId: 'r_edu', evidenceUrls: ['data:image/jpeg;base64,X'] })];
    const user = userEvent.setup();
    wrap(<ValidationQueue tournamentId="tn_1" />);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);

    const first = within(cards[0] as HTMLElement);
    expect(first.getByRole('heading', { level: 3, name: 'Quartas de final: Bianca x Caio' })).toBeInTheDocument();
    expect(first.getByText('Bianca 2 x 1 Caio')).toBeInTheDocument();
    expect(first.getByText('Confirmado pelo adversário')).toBeInTheDocument();
    expect(first.getByText(/Enviado por Bianca em/)).toBeInTheDocument();
    expect(first.getAllByRole('button', { name: /Abrir print/ })).toHaveLength(2);

    // Partida que ainda não está na lista carregada: placar sem os nomes, na ordem do confronto.
    const second = within(cards[1] as HTMLElement);
    expect(second.getByText('0 x 2')).toBeInTheDocument();
    expect(second.getByText('Sem resposta do adversário')).toBeInTheDocument();

    await user.click(first.getByRole('button', { name: 'Abrir print 2' }));
    const viewer = await screen.findByRole('dialog', { name: 'Print 2' });
    expect(within(viewer).getByRole('img', { name: 'Print 2' })).toHaveAttribute('src', 'data:image/jpeg;base64,PRINT2');
  });

  it('aprovar chama a API e avisa que o placar é oficial', async () => {
    state.queue.data = [submission()];
    const user = userEvent.setup();
    wrap(<ValidationQueue tournamentId="tn_1" />);
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(state.review.mutate).toHaveBeenCalledWith({ submissionId: 'sub_1', input: { action: 'approve' } }, expect.anything());
    const [, options] = vi.mocked(state.review.mutate).mock.calls[0] as [unknown, MutateOptions];
    options.onSuccess?.();
    options.onSettled?.();
    expect(await screen.findByText('Resultado aprovado')).toBeInTheDocument();
    expect(screen.getByText(/o placar agora é oficial/)).toBeInTheDocument();
  });

  it('recusar exige o motivo', async () => {
    state.queue.data = [submission()];
    const user = userEvent.setup();
    wrap(<ValidationQueue tournamentId="tn_1" />);
    await user.click(screen.getByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recusar resultado enviado' });
    await user.click(within(dialog).getByRole('button', { name: 'Recusar envio' }));
    expect(await within(dialog).findByText('Informe o motivo')).toBeInTheDocument();
    expect(state.review.mutate).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Motivo da recusa/), 'O print não mostra o placar final.');
    await user.click(within(dialog).getByRole('button', { name: 'Recusar envio' }));
    await waitFor(() => expect(state.review.mutate).toHaveBeenCalledTimes(1));
    const [input, options] = vi.mocked(state.review.mutate).mock.calls[0] as [unknown, MutateOptions];
    expect(input).toEqual({ submissionId: 'sub_1', input: { action: 'reject', reason: 'O print não mostra o placar final.' } });
    options.onSuccess?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Envio recusado')).toBeInTheDocument();
  });
});

describe('DisputeList', () => {
  it('lista as disputas com status e link; conta as que aguardam decisão', () => {
    state.disputes.data = [dispute(), dispute({ id: 'dp_2', status: 'ESCALATED', matchLabel: 'Semifinal: Dani x Edu' }), dispute({ id: 'dp_3', status: 'RESOLVED', resolution: 'Mantido.', matchLabel: 'Oitavas: Fabi x Gui' })];
    wrap(<DisputeList tournamentId="tn_1" />);
    expect(screen.getByText('2 disputas aguardando decisão.')).toBeInTheDocument();
    const rows = screen.getAllByRole('article');
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Aberta')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/Contestado por Caio em/)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Abrir disputa' })).toHaveAttribute('href', '/disputas/dp_1');
    expect(within(rows[1] as HTMLElement).getByText('Escalada')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Resolvida')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByRole('link', { name: 'Ver histórico' })).toHaveAttribute('href', '/disputas/dp_3');
    expect(state.channels).toEqual(['tn_1']);
  });

  it('vazio e carregando', () => {
    const { rerender } = wrap(<DisputeList tournamentId="tn_1" />);
    expect(screen.getByRole('heading', { name: 'Nenhuma disputa neste campeonato' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma disputa aguardando decisão.')).toBeInTheDocument();
    state.disputes = { ...state.disputes, isPending: true, data: undefined as never };
    rerender(
      <ToastProvider>
        <DisputeList tournamentId="tn_1" />
      </ToastProvider>,
    );
    expect(screen.getByRole('status', { name: 'Carregando disputas' })).toBeInTheDocument();
  });
});
