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
import { GameAccountWarning } from './GameAccountWarning';
import { checkSquadSize, squadSizeMessage } from './lib/rules';

interface RegisterFormProps {
  tournament: Tournament;
  game: Game;
  viewerId: string;
  /** Sem vaga: a inscrição entra na lista de espera, nesta posição. */
  waitlistPosition: number | null;
  missingGameAccount: boolean;
}

function successMessage(r: Registration): [string, string | undefined] {
  switch (r.status) {
    case 'WAITLIST':
      return ['Você entrou na lista de espera', r.waitlistPosition ? `Sua posição: ${r.waitlistPosition}º. Se abrir vaga, a entrada é automática.` : undefined];
    case 'PENDING_MEMBERS':
      return ['Squad inscrito', 'Agora os membros precisam confirmar a participação.'];
    case 'PENDING_APPROVAL':
      return ['Inscrição enviada', 'A organização vai analisar e aprovar.'];
    default:
      return ['Inscrição confirmada', 'Boa sorte!'];
  }
}

/** Formulário de inscrição: solo (aceite do regulamento) ou com squad (escolher um squad em que sou capitão). */
export function RegisterForm({ tournament, game, viewerId, waitlistPosition, missingGameAccount }: RegisterFormProps) {
  const isTeam = tournament.participantType === 'TEAM';
  const mode = game.modes.find((m) => m.id === tournament.gameModeId);
  const { success, error } = useToast();
  const register = useRegisterInTournament(tournament.id);
  const teams = useMyTeams({ enabled: isTeam });

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
      setProblem({ message: 'Escolha o squad que vai jogar.', needsGameAccount: false });
      return;
    }
    // Mesmo contrato da API: sem o aceite do regulamento a inscrição não sai daqui.
    const input = RegisterInTournamentInput.safeParse({ acceptRules: accepted, teamId: isTeam ? selectedId : undefined });
    if (!input.success) {
      setProblem({ message: 'Para se inscrever, marque que você leu e aceita o regulamento.', needsGameAccount: false });
      return;
    }
    register.mutate(input.data, {
      onSuccess: (r) => success(...successMessage(r)),
      onError: (err) => {
        setProblem({ message: errorMessage(err), needsGameAccount: err instanceof ApiError && err.code === 'GAME_ACCOUNT_REQUIRED' });
        error('Não foi possível concluir a inscrição', errorMessage(err));
      },
    });
  }

  if (missingGameAccount) return <GameAccountWarning gameName={game.name} context="register" />;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {isTeam &&
        (teams.isPending ? (
          <div role="status" aria-label="Carregando seus squads">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : teams.isError ? (
          <ErrorState title="Não foi possível carregar seus squads" description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
        ) : (
          <div className="flex flex-col gap-3">
            {captained.length === 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-dashed border-border-strong p-3 text-sm text-muted">
                <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {teams.data.length > 0
                    ? 'Só o capitão inscreve o squad. Peça ao capitão do seu time para inscrever, ou crie um squad seu.'
                    : `Este campeonato é por squad${mode ? ` de ${mode.teamSize} jogadores` : ''}. Crie o seu squad para se inscrever.`}
                </span>
              </p>
            ) : (
              <Select
                label="Squad que vai jogar"
                placeholder="Escolha um squad"
                value={selectedId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setProblem(null);
                }}
                options={captained.map((t) => ({ value: t.id, label: `${t.name} [${t.tag}] · ${t.members.length === 1 ? '1 jogador' : `${t.members.length} jogadores`}` }))}
              />
            )}
            {selected && sizeProblem && (
              <p role="alert" className="rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-text">
                {sizeProblem}{' '}
                <Link href={`/minha-conta/squads/${selected.id}`} className="font-semibold underline">
                  Abrir o squad
                </Link>
              </p>
            )}
            <Button variant="ghost" size="sm" className="self-start" iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              Criar um squad novo
            </Button>
          </div>
        ))}

      <Checkbox
        label={
          <>
            Li e aceito o{' '}
            <Link href={`/c/${tournament.slug}?aba=regulamento`} className="font-semibold text-primary-text underline underline-offset-2">
              regulamento
            </Link>{' '}
            deste campeonato
          </>
        }
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
              <Link href="/minha-conta">Informar meu ID de {game.name}</Link>
            </Button>
          )}
        </div>
      )}

      <Button type="submit" size="lg" fullWidth loading={register.isPending} disabled={isTeam && (captained.length === 0 || Boolean(sizeProblem))}>
        {onWaitlist ? 'Entrar na lista de espera' : isTeam ? 'Inscrever squad' : 'Inscrever-se'}
      </Button>
      {isTeam && !onWaitlist && mode && <p className="text-xs text-muted">Depois da inscrição, cada jogador confirma a participação. A inscrição vale quando {mode.teamSize} confirmarem.</p>}

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
