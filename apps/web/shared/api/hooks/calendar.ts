'use client';

/** Calendário .ics (issue 125): endereços para assinar e o download do arquivo. */
import { CalendarFeed } from '@nova/schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../client';
import { keys } from '../keys';

/** "Minhas partidas" (exige sessão). */
export function useMyCalendarFeed(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.calendar.mine,
    queryFn: ({ signal }) => api.get('/me/calendar', { schema: CalendarFeed, signal }),
    enabled: opts.enabled ?? true,
  });
}

/** Partidas de um campeonato (público). */
export function useTournamentCalendarFeed(idOrSlug: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.calendar.tournament(idOrSlug ?? ''),
    queryFn: ({ signal }) => api.get(`/tournaments/${idOrSlug}/calendar`, { schema: CalendarFeed, signal }),
    enabled: Boolean(idOrSlug) && (opts.enabled ?? true),
  });
}

/** Baixa o arquivo .ics do endereço do calendário (mesma origem: a API real ou a simulada). */
export async function downloadCalendar(feed: CalendarFeed): Promise<{ blob: Blob; filename: string }> {
  // Sempre na origem da página: o endereço público pode apontar para outro domínio (ex.: produção vista do preview).
  const res = await fetch(new URL(feed.url).pathname, { credentials: 'same-origin', headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new ApiError({ type: 'about:blank', title: 'Não foi possível baixar o calendário. Tente de novo.', status: res.status });
  return { blob: new Blob([await res.text()], { type: 'text/calendar' }), filename: feed.filename };
}

export function useDownloadCalendar() {
  return useMutation({ mutationFn: downloadCalendar });
}
