'use client';

import type { Registration, Tournament } from '@nova/schemas';
import { Avatar, Button, ErrorState, Skeleton, useToast } from '@nova/ui';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useAddRosterMember } from '@/shared/api/hooks/registrations';
import { useTeam } from '@/shared/api/hooks/teams';
import { useT } from '@/shared/i18n/react';
import { rosterLimit } from './lib/rules';
import { messages } from './messages';

/**
 * Capitão escala membros do squad que ainda não estão no elenco deste campeonato (até a trava de elenco).
 * Quem é escalado recebe o aviso para confirmar; para trazer gente nova, o caminho é o convite do squad.
 */
export function CaptainRoster({ tournament, registration }: { tournament: Tournament; registration: Registration }) {
  const t = useT(messages, 'CaptainRoster');
  const team = useTeam(registration.teamId ?? undefined);
  const add = useAddRosterMember();
  const { success, error } = useToast();
  const game = useGame(tournament.gameId);
  const mode = game.data?.modes.find((m) => m.id === tournament.gameModeId);
  const limit = mode ? rosterLimit(mode) : registration.requiredMembers;
  const full = registration.members.length >= limit;

  if (team.isPending || game.isPending) {
    return (
      <div role="status" aria-label={t('carregando')}>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (team.isError) return <ErrorState title={t('erroCarregar')} description={errorMessage(team.error)} onRetry={() => void team.refetch()} />;

  const inRoster = new Set(registration.members.map((m) => m.userId));
  const outside = team.data.members.filter((m) => !inRoster.has(m.userId));

  function escalar(userId: string, nickname: string) {
    add.mutate(
      { registrationId: registration.id, input: { userId } },
      {
        onSuccess: () => success(t('escalou', { nome: nickname }), t('escalouDescricao')),
        onError: (e) => error(t('erroEscalar'), errorMessage(e)),
      },
    );
  }

  return (
    <section aria-labelledby={`escalar-${registration.id}`} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h3 id={`escalar-${registration.id}`} className="text-sm font-bold">
        {t('titulo')}
      </h3>
      {full ? (
        <p className="text-sm text-muted">{t('elencoCheio', { limite: limit })}</p>
      ) : outside.length === 0 ? (
        <p className="text-sm text-muted">{t('todosNoElenco')}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{t('descricao')}</p>
          <ul className="flex flex-col divide-y divide-border">
            {outside.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Avatar name={m.nickname} src={m.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.nickname}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={<UserPlus className="size-4" aria-hidden />}
                  aria-label={t('escalarRotulo', { nome: m.nickname })}
                  loading={add.isPending && add.variables?.input.userId === m.userId}
                  disabled={add.isPending}
                  onClick={() => escalar(m.userId, m.nickname)}
                >
                  {t('escalar')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!full && (
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href={`/minha-conta/squads/${registration.teamId ?? ''}`}>{t('chamarMais')}</Link>
        </Button>
      )}
    </section>
  );
}
