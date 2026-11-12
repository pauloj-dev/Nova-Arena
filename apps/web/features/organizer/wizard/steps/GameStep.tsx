'use client';

import type { Game, GameMode } from '@nova/schemas';
import { Badge, cn, EmptyState } from '@nova/ui';
import { Gamepad2, Lock, User, Users } from 'lucide-react';
import { useId } from 'react';
import { MATCH_TYPE_LABEL } from '../../lib/labels';
import { IssueList } from '../../stage-builder/IssueList';
import { useWizard } from '../context';

interface GameStepProps {
  onSelect: (game: Game, mode: GameMode) => void;
}

const MATCH_TYPE_NAME = { BATTLE_ROYALE: 'Battle Royale', DUEL: 'Duelo 1v1', TEAM_VS_TEAM: 'Equipe x Equipe' } as const;

function modeDetails(mode: GameMode): string {
  const team = mode.teamSize > 1 ? `Equipes de ${mode.teamSize}${mode.maxSubs > 0 ? ` + ${mode.maxSubs} ${mode.maxSubs === 1 ? 'reserva' : 'reservas'}` : ''}` : 'Individual';
  const lobby = mode.matchType === 'BATTLE_ROYALE' && mode.maxLobbySize ? ` · até ${mode.maxLobbySize} por sala` : '';
  return `${team}${lobby}`;
}

const card = 'flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent';

/** Passo 2 — Jogo e modo. O modo define se a inscrição é individual ou por squad e quais formatos de fase servem. */
export function GameStep({ onSelect }: GameStepProps) {
  const { selectableGames, game, mode, isPublished, fieldError } = useWizard();
  const id = useId();
  const errors = [fieldError('gameId'), fieldError('gameModeId')].filter((m): m is string => Boolean(m));

  if (selectableGames.length === 0) {
    return <EmptyState icon={<Gamepad2 className="size-7" />} title="Nenhum jogo disponível" description="Sua conta ainda não está liberada para nenhum jogo ativo. Fale com a administração da Nova Arena." />;
  }
  // Campeonato antigo de um jogo que saiu do catálogo continua aparecendo na lista.
  const games = game && !selectableGames.some((g) => g.id === game.id) ? [game, ...selectableGames] : selectableGames;

  return (
    <div className="flex flex-col gap-6">
      {isPublished && (
        <p className="flex items-center gap-2 rounded-md bg-neutral-soft px-3 py-2 text-sm text-neutral-soft-text">
          <Lock className="size-4 shrink-0" aria-hidden />
          O jogo e o modo não mudam depois que o campeonato é publicado.
        </p>
      )}
      <IssueList messages={errors} />
      <fieldset disabled={isPublished} className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-text">Jogo</legend>
        <div className="grid gap-2 xs:grid-cols-2">
          {games.map((g) => {
            const checked = g.id === game?.id;
            return (
              <label key={g.id} htmlFor={`${id}-game-${g.id}`} className={cn(card, 'items-center', checked ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2', isPublished && 'cursor-not-allowed opacity-70')}>
                <input
                  id={`${id}-game-${g.id}`}
                  type="radio"
                  name={`${id}-game`}
                  className="size-4 shrink-0 accent-(--accent)"
                  checked={checked}
                  onChange={() => {
                    const first = g.modes[0];
                    if (first) onSelect(g, first);
                  }}
                />
                <span className="text-2xl" aria-hidden>
                  {g.icon}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-text">{g.name}</span>
                  <span className="text-xs text-muted">{g.platform}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {game && (
        <fieldset disabled={isPublished} className="flex min-w-0 flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold text-text">Modo de {game.name}</legend>
          <div className="grid gap-2 md:grid-cols-2">
            {game.modes.map((m) => {
              const checked = m.id === mode?.id;
              const isTeam = m.teamSize > 1;
              return (
                <label key={m.id} htmlFor={`${id}-mode-${m.id}`} className={cn(card, checked ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2', isPublished && 'cursor-not-allowed opacity-70')}>
                  <input id={`${id}-mode-${m.id}`} type="radio" name={`${id}-mode`} className="mt-1 size-4 shrink-0 accent-(--accent)" checked={checked} onChange={() => onSelect(game, m)} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-semibold text-text">{m.name}</span>
                    <span className="text-xs text-muted">{modeDetails(m)}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{MATCH_TYPE_NAME[m.matchType]}</Badge>
                      <Badge tone="accent" icon={isTeam ? <Users className="size-3.5" aria-hidden /> : <User className="size-3.5" aria-hidden />}>
                        {isTeam ? 'Inscrição por squad' : 'Inscrição individual'}
                      </Badge>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {mode && (
            <p className="text-sm text-muted" role="status">
              {mode.teamSize > 1 ? `Quem se inscreve é o squad, com ${mode.teamSize} jogadores confirmados.` : 'Cada jogador se inscreve sozinho.'} As fases serão de {MATCH_TYPE_LABEL[mode.matchType]}
              {mode.matchType === 'BATTLE_ROYALE' ? ' (e, se o jogo tiver, de duelos entre equipes)' : ''}.
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
