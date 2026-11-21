'use client';

import { RegisterInTournamentInput, type Game, type Registration, type Tournament } from '@nova/schemas';
import { Button, Checkbox, ErrorState, Select, Skeleton, useToast } from '@nova/ui';
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { TeamFormModal } from '@/features/teams/TeamFormModal';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useRegisterInTournament } from '@/shared/api/hooks/registrations';
import { useMyTeams } from '@/shared/api/hooks/teams';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { GameAccountWarning } from './GameAccountWarning';
import { checkSquadSize, squadSizeMessage } from './lib/rules';
import { messages } from './messages';

interface RegisterFormProps {
  tournament: Tournament;
  game: Game;
  viewerId: string;
  /** Sem vaga: a inscrição entra na lista de espera, nesta posição. */
  waitlistPosition: number | null;
  missingGameAccount: boolean;
}

function successMessage(r: Registration): [string, string | undefined] {
  const t = getT(messages, 'RegisterForm.sucesso');
  switch (r.status) {
    case 'WAITLIST':
      return [t('listaEspera'), r.waitlistPosition ? t('listaEsperaPosicao', { posicao: r.waitlistPosition }) : undefined];
    case 'PENDING_MEMBERS':
      return [t('squadInscrito'), t('squadInscritoDescricao')];
    case 'PENDING_APPROVAL':
      return [t('enviada'), t('enviadaDescricao')];
    default:
      return [t('confirmada'), t('confirmadaDescricao')];
  }
}

/** Formulário de inscrição: solo (aceite do regulamento) ou com squad (escolher um squad em que sou capitão). */
export function RegisterForm({ tournament, game, viewerId, waitlistPosition, missingGameAccount }: RegisterFormProps) {
  const isTeam = tournament.participantType === 'TEAM';
  const mode = game.modes.find((m) => m.id === tournament.gameModeId);
  const { success, error } = useToast();
  const register = useRegisterInTournament(tournament.id);
  const teams = useMyTeams({ enabled: isTeam });
  const t = useT(messages, 'RegisterForm');

  const [accepted, setAccepted] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<{ message: string; needsGameAccount: boolean } | null>(null);

  const captained = (teams.data ?? []).filter((t) => t.captainId === viewerId);
  // Com um squad só, ele já vem escolhido.
  const selectedId = teamId || (captained.length === 1 ? (captained[0]?.id ?? '') : '');
  const selected = captained.find((t) => t.id === selectedId);
  const sizeProblem = selected && mode ? squadSizeMessage(checkSquadSize(selected.members.length, mode), mode) : null;
  const onWaitlist = waitlistPosition !== null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    if (isTeam && !selectedId) {
      setProblem({ message: t('escolhaSquad'), needsGameAccount: false });
      return;
    }
    // Mesmo contrato da API: sem o aceite do regulamento a inscrição não sai daqui.
    const input = RegisterInTournamentInput.safeParse({ acceptRules: accepted, teamId: isTeam ? selectedId : undefined });
    if (!input.success) {
      setProblem({ message: t('aceiteObrigatorio'), needsGameAccount: false });
      return;
    }
    register.mutate(input.data, {
      onSuccess: (r) => success(...successMessage(r)),
      onError: (err) => {
        setProblem({ message: errorMessage(err), needsGameAccount: err instanceof ApiError && err.code === 'GAME_ACCOUNT_REQUIRED' });
        error(t('erroInscrever'), errorMessage(err));
      },
    });
  }

  if (missingGameAccount) return <GameAccountWarning gameName={game.name} context="register" />;

  const acceptLabel = t.rich('aceite', {
    link: (chunks) => (
      <Link href={`/c/${tournament.slug}?aba=regulamento`} className="font-semibold text-primary-text underline underline-offset-2">
        {chunks}
      </Link>
    ),
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {isTeam &&
        (teams.isPending ? (
          <div role="status" aria-label={t('carregandoSquads')}>
            <Skeleton className="h-16 w-full" />
          </div>
        ) : teams.isError ? (
          <ErrorState title={t('erroCarregarSquads')} description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
        ) : (
          <div className="flex flex-col gap-3">
            {captained.length === 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-dashed border-border-strong p-3 text-sm text-muted">
                <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {teams.data.length > 0 ? t('soCapitao') : mode ? t('porSquadDeN', { tamanho: mode.teamSize }) : t('porSquad')}
                </span>
              </p>
            ) : (
              <Select
                label={t('squadQueVaiJogar')}
                placeholder={t('escolhaUmSquad')}
                value={selectedId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setProblem(null);
                }}
                options={captained.map((team) => ({ value: team.id, label: t('opcaoSquad', { nome: team.name, tag: team.tag, count: team.members.length }) }))}
              />
            )}
            {selected && sizeProblem && (
              <p role="alert" className="rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-text">
                {sizeProblem}{' '}
                <Link href={`/minha-conta/squads/${selected.id}`} className="font-semibold underline">
                  {t('abrirSquad')}
                </Link>
              </p>
            )}
            <Button variant="ghost" size="sm" className="self-start" iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              {t('criarSquadNovo')}
            </Button>
          </div>
        ))}

      <Checkbox
        label={acceptLabel}
        checked={accepted}
        onCheckedChange={(checked) => {
          setAccepted(checked);
          setProblem(null);
        }}
      />

      {problem && (
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger-soft-text" data-testid="registration-error">
          <p>{problem.message}</p>
          {problem.needsGameAccount && (
            <Button asChild variant="secondary" size="sm" className="self-start">
              <Link href="/minha-conta">{t('informarId', { jogo: game.name })}</Link>
            </Button>
          )}
        </div>
      )}

      <Button type="submit" size="lg" fullWidth loading={register.isPending} disabled={isTeam && (captained.length === 0 || Boolean(sizeProblem))}>
        {onWaitlist ? t('entrarListaEspera') : isTeam ? t('inscreverSquad') : t('inscreverSe')}
      </Button>
      {isTeam && !onWaitlist && mode && <p className="text-xs text-muted">{t('depoisDaInscricao', { tamanho: mode.teamSize })}</p>}

      <TeamFormModal
        open={creating}
        onOpenChange={setCreating}
        onSaved={(team) => {
          setTeamId(team.id);
          setProblem(null);
        }}
      />
    </form>
  );
}
