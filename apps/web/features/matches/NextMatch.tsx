'use client';

import type { MyTournamentEntry } from '@nova/schemas';
import { Clock, Swords } from 'lucide-react';
import Link from 'next/link';
import { useMatch } from '@/shared/api/hooks/competition';
import { useTournament } from '@/shared/api/hooks/tournaments';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { CheckInPanel } from './CheckInPanel';
import { useNow } from './useNow';
import type { MatchViewer } from './viewer';

/** Link que abre a partida na página do campeonato (aba "Partidas", com o detalhe aberto). */
export function matchHref(tournamentSlug: string, matchId: string): string {
  return `/c/${tournamentSlug}?aba=partidas&partida=${encodeURIComponent(matchId)}`;
}

/**
 * Próxima partida de uma inscrição, para a home e "Meus campeonatos" (PRD §15.1: quando jogo e
 * contra quem). Mostra adversário, horário com fuso, o check-in (botão e contagem quando aberto)
 * e o link para a partida.
 */
export function NextMatch({ entry, viewerId }: { entry: MyTournamentEntry; viewerId: string | null }) {
  const next = entry.nextMatch;
  const match = useMatch(next?.id);
  // Só squads precisam da regra de check-in do campeonato (capitão ou todos os titulares).
  const tournament = useTournament(next && entry.registration.teamId ? entry.tournament.slug : undefined);
  const now = useNow(30_000, Boolean(next?.scheduledAt));
  if (!next) return null;

  const viewer: MatchViewer = { userId: viewerId, registration: entry.registration, checkIn: tournament.data?.checkIn ?? null };
  return (
    <div className="relative z-10 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm" data-testid="next-match">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Swords className="size-4 shrink-0" aria-hidden />
        Próxima partida
      </p>
      <p className="font-semibold">
        {next.label}
        {next.opponent ? ` · contra ${next.opponent}` : ''}
      </p>
      <p>
        {next.scheduledAt ? (
          <>
            {formatDateTime(next.scheduledAt)} <span className="text-muted">({formatRelative(next.scheduledAt, new Date(now))})</span>
          </>
        ) : (
          'Horário a definir'
        )}
      </p>
      {match.data ? (
        <CheckInPanel match={match.data} viewer={viewer} />
      ) : (
        next.checkInOpen && (
          <p className="flex items-center gap-1.5 font-semibold text-warning-soft-text">
            <Clock className="size-4 shrink-0" aria-hidden />
            Check-in aberto
          </p>
        )
      )}
      <Link href={matchHref(entry.tournament.slug, next.id)} className="flex min-h-11 items-center self-start font-semibold text-primary-text underline-offset-2 hover:underline">
        Ver partida
        <span className="sr-only">: {next.label}</span>
      </Link>
    </div>
  );
}
