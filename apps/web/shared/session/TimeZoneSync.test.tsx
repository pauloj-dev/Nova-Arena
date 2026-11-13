import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatTime, setPreferredTimeZone } from '../lib/datetime';
import { keys } from '../api/keys';
import { TimeZoneSync } from './TimeZoneSync';

function Clock() {
  return <p>{formatTime('2026-11-14T23:00:00.000Z')}</p>;
}

function renderWith(me: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(keys.me, me);
  return render(
    <QueryClientProvider client={qc}>
      <TimeZoneSync>
        <Clock />
      </TimeZoneSync>
    </QueryClientProvider>,
  );
}

describe('TimeZoneSync', () => {
  afterEach(() => setPreferredTimeZone(null));

  it('aplica o fuso do perfil às datas da tela', () => {
    renderWith({ timezone: 'America/Manaus', roles: [] });
    expect(screen.getByText('19h')).toBeInTheDocument();
  });

  it('visitante fica no fuso do navegador', () => {
    renderWith(null);
    expect(screen.getByText('20h')).toBeInTheDocument();
  });
});
