import type { MyTournamentEntry } from '@nova/schemas';
import { Card, StatusPill } from '@nova/ui';
import { AlertCircle, CalendarClock, Medal, Users } from 'lucide-react';
import Link from 'next/link';
import { NextMatch } from '@/features/matches/NextMatch';
import { formatDateTime } from '@/shared/lib/datetime';
import { registrationPendencies } from './lib/rules';

/** Uma inscrição minha: campeonato, data com fuso, status, próxima partida e o que falta resolver. Usado na home e em "Meus campeonatos". */
export function RegistrationEntryCard({ entry, viewerId }: { entry: MyTournamentEntry; viewerId: string | null }) {
  const { tournament: t, registration: r, finalPlacement } = entry;
  const pendencies = registrationPendencies(r, viewerId);

  return (
    <Card interactive padding="sm" className="relative flex h-full flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-xl" aria-hidden>
          {t.gameIcon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base">
            {/* O link cobre o cartão inteiro; o nome acessível é o do campeonato. */}
            <Link href={`/c/${t.slug}`} className="after:absolute after:inset-0 after:rounded-lg">
              {t.name}
            </Link>
          </h3>
          <p className="text-sm text-muted">
            {t.gameName} · {t.modeName}
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
            {finalPlacement}º lugar
          </span>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-sm text-text">
        <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
        {t.startsAt ? `Começa ${formatDateTime(t.startsAt)}` : 'Data de início ainda não definida'}
      </p>

      {/* Próxima partida (F2): adversário, horário, check-in e link direto para a partida. */}
      <NextMatch entry={entry} viewerId={viewerId} />

      {pendencies.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Pendências">
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
