import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@nova/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { PendingResultsPanel } from './PendingResultsPanel';
import { enqueue, memoryStore, type PendingResult, type ResultStore } from './queue';

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

afterEach(() => setOnline(true));

const item = (n: number) => ({
  idempotencyKey: `k${n}`,
  matchId: `fase~m${n}`,
  tournamentId: 't1',
  stageId: 'fase',
  label: `Final BR · Queda ${n}`,
  payload: { entries: [{ registrationId: 'r1', placement: 1, kills: 7 }], evidenceUrls: [] },
});

function renderPanel(store: ResultStore, send: (i: PendingResult) => Promise<unknown>, onOpenMatch = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PendingResultsPanel tournamentId="t1" onOpenMatch={onOpenMatch} store={store} send={send} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onOpenMatch };
}

describe('PendingResultsPanel', () => {
  it('sem conexão mostra o que está guardado e envia sozinho quando a conexão volta', async () => {
    setOnline(false);
    const store = memoryStore();
    await enqueue(store, item(1));
    const send = vi.fn<(item: PendingResult) => Promise<undefined>>(async () => undefined);
    renderPanel(store, send);
    const list = await screen.findByRole('list', { name: 'Resultados guardados neste aparelho' });
    expect(within(list).getByText('Final BR · Queda 1')).toBeInTheDocument();
    expect(within(list).getByTestId('pending-status')).toHaveTextContent('Aguardando conexão');
    expect(screen.getByText(/Você está sem conexão/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();

    setOnline(true);
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: 'k1', matchId: 'fase~m1' });
    expect(await screen.findByText('Resultado guardado foi enviado')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('pending-results')).not.toBeInTheDocument());
  });

  it('conflito: mostra que outra pessoa lançou e leva ao resultado atual', async () => {
    const store = memoryStore();
    await enqueue(store, item(2));
    const send = vi.fn(async () => {
      throw new ApiError({ type: 'about:blank', title: 'Informe o motivo da correção.', status: 400, code: 'CORRECTION_REASON_REQUIRED' });
    });
    const { onOpenMatch } = renderPanel(store, send);
    expect(await screen.findByText(/Outra pessoa já lançou o resultado desta partida/)).toBeInTheDocument();
    expect(screen.getByTestId('pending-status')).toHaveTextContent('Conflito');
    await userEvent.click(screen.getByRole('button', { name: 'Ver resultado atual' }));
    expect(onOpenMatch).toHaveBeenCalledWith('fase~m2');
  });

  it('descartar pede confirmação', async () => {
    setOnline(false);
    const store = memoryStore();
    await enqueue(store, item(3));
    renderPanel(store, vi.fn());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Descartar o resultado guardado de Final BR · Queda 3' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar descarte' }));
    await waitFor(() => expect(screen.queryByTestId('pending-results')).not.toBeInTheDocument());
    expect(await store.list()).toEqual([]);
  });
});
