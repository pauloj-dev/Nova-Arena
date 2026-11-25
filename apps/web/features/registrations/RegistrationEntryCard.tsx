import type { MyTournamentEntry } from '@nova/schemas';
import { Card, StatusPill } from '@nova/ui';
import { AlertCircle, CalendarClock, Medal, Users } from 'lucide-react';
import Link from 'next/link';
import { NextMatch } from '@/features/matches/NextMatch';
import { getT } from '@/shared/i18n/core';
import { formatDateTime } from '@/shared/lib/datetime';
import { registrationPendencies } from './lib/rules';
import { messages } from './messages';
import { GameIcon } from '@/shared/brand/GameIcon';

/** Uma inscrição minha: campeonato, data com fuso, status, próxima partida e o que falta resolver. Usado na home e em "Meus campeonatos". */
export function RegistrationEntryCard({ entry, viewerId }: { entry: MyTournamentEntry; viewerId: string | null }) {
  const t = getT(messages, 'RegistrationEntryCard');
  const { tournament, registration: r, finalPlacement } = entry;
  const pendencies = registrationPendencies(r, viewerId);

  return (
    <Card interactive padding="sm" className="relative flex h-full flex-col gap-3">
      <div className="flex items-start gap-3">
        <GameIcon icon={tournament.gameIcon} coverUrl={tournament.gameCoverUrl} className="size-11 rounded-md bg-neutral-soft text-xl" px={44} />
        <div className="min-w-0 flex-1">
          <h3 className="text-base">
            {/* O link cobre o cartão inteiro; o nome acessível é o do campeonato. */}
            <Link href={`/c/${tournament.slug}`} className="after:absolute after:inset-0 after:rounded-lg">
              {tournament.name}
            </Link>
          </h3>
          <p className="text-sm text-muted">
            {tournament.gameName} · {tournament.modeName}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={r.status} />
        {r.teamId && (
          <span className="flex items-center gap-1 text-sm text-muted">
            <Users className="size-4" aria-hidden />
            {r.displayName}
          </span>
        )}
        {finalPlacement !== null && (
          <span className="flex items-center gap-1 text-sm font-semibold text-text">
            <Medal className="size-4" aria-hidden />
            {t('colocacao', { posicao: finalPlacement })}
          </span>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-sm text-text">
        <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
        {tournament.startsAt ? t('comeca', { data: formatDateTime(tournament.startsAt) }) : t('semData')}
      </p>

      {/* Próxima partida (F2): adversário, horário, check-in e link direto para a partida. */}
      <NextMatch entry={entry} viewerId={viewerId} />

      {pendencies.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t('pendencias')}>
          {pendencies.map((text) => (
            <li key={text} className="flex items-start gap-1.5 text-sm font-medium text-warning-soft-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
