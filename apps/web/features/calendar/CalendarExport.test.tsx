import type { CalendarFeed } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarExport } from './CalendarExport';

const FEED: CalendarFeed = {
  url: 'https://novaarena.gg/api/v1/calendar/u/u_bianca.abc.ics',
  webcalUrl: 'webcal://novaarena.gg/api/v1/calendar/u/u_bianca.abc.ics',
  filename: 'minhas-partidas-nova-arena.ics',
  events: 2,
};

type QueryState = { isPending: boolean; isError: boolean; error: unknown; data: CalendarFeed | undefined; refetch: () => void };
const state = vi.hoisted(() => ({
  query: null as unknown as QueryState,
  download: vi.fn(),
  saved: vi.fn(),
}));

vi.mock('@/shared/api/hooks/calendar', () => ({
  useMyCalendarFeed: () => state.query,
  useTournamentCalendarFeed: () => state.query,
  useDownloadCalendar: () => ({ mutate: state.download, isPending: false }),
}));
vi.mock('@/features/organizer/lib/download', () => ({ downloadFile: (...args: unknown[]) => state.saved(...args) }));

function setup(query: Partial<QueryState>) {
  state.query = { isPending: false, isError: false, error: null, data: FEED, refetch: vi.fn(), ...query };
  render(
    <ToastProvider>
      <CalendarExport scope={{ kind: 'mine' }} />
    </ToastProvider>,
  );
  return userEvent.setup();
}

describe('CalendarExport', () => {
  beforeEach(() => {
    state.download.mockReset();
    state.saved.mockReset();
  });

  it('abre com o endereço para assinar (webcal), copiar e baixar', async () => {
    const user = setup({});
    await user.click(screen.getByRole('button', { name: 'Adicionar ao calendário' }));
    const dialog = screen.getByRole('dialog', { name: 'Minhas partidas no calendário' });
    expect(within(dialog).getByTestId('calendar-count')).toHaveTextContent('2 partidas com horário marcado para você');
    expect(within(dialog).getByRole('link', { name: 'Abrir no aplicativo de calendário' })).toHaveAttribute('href', FEED.webcalUrl);
    expect(within(dialog).getByLabelText(/Endereço do calendário/)).toHaveValue(FEED.url);

    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(within(dialog).getByRole('button', { name: 'Copiar endereço' }));
    expect(writeText).toHaveBeenCalledWith(FEED.url);
    expect(within(dialog).getByRole('button', { name: 'Endereço copiado' })).toBeInTheDocument();

    state.download.mockImplementation((_feed: CalendarFeed, opts: { onSuccess: (r: { blob: Blob; filename: string }) => void }) => opts.onSuccess({ blob: new Blob(['BEGIN:VCALENDAR']), filename: FEED.filename }));
    await user.click(within(dialog).getByRole('button', { name: 'Baixar arquivo .ics' }));
    expect(state.saved).toHaveBeenCalledWith(expect.any(Blob), FEED.filename, 'text/calendar');
  });

  it('sem partidas marcadas, explica que elas aparecem depois', async () => {
    const user = setup({ data: { ...FEED, events: 0 } });
    await user.click(screen.getByRole('button', { name: 'Adicionar ao calendário' }));
    expect(screen.getByTestId('calendar-count')).toHaveTextContent('Ainda não há partidas com horário marcado');
  });

  it('carregando', async () => {
    const user = setup({ isPending: true, data: undefined });
    await user.click(screen.getByRole('button', { name: 'Adicionar ao calendário' }));
    expect(screen.getByRole('status', { name: 'Carregando o calendário' })).toBeInTheDocument();
  });

  it('erro com "Tentar novamente"', async () => {
    const refetch = vi.fn();
    const user = setup({ isError: true, data: undefined, error: new Error('x'), refetch });
    await user.click(screen.getByRole('button', { name: 'Adicionar ao calendário' }));
    expect(screen.getByText('Não foi possível preparar o calendário')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Tentar novamente/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
