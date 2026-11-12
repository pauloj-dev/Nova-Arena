'use client';

import type { Match, MatchParticipant } from '@nova/schemas';
import { Badge, cn, StatusPill } from '@nova/ui';
import { Star, Trophy } from 'lucide-react';
import { matchAriaLabel, MATCH_STATUS_PILL_LABEL, isConcluded, participantOf, scheduleText, slotText } from '@/features/matches/matchText';
import type { SlotExtension } from './types';

export interface MatchRowProps extends SlotExtension {
  match: Match;
  highlightRegistrationId?: string | null;
  onSelect: (match: Match) => void;
  /** Mostra o rótulo da rodada no cartão (quando a lista mistura rodadas, ex.: final + 3º lugar). */
  showRoundLabel?: boolean;
}

function Side({ p, match, mine, selected, onSlotClick, getSlotProps, renderSlotAction }: { p: MatchParticipant; match: Match; mine: boolean; selected: boolean } & SlotExtension) {
  const known = p.registrationId !== null;
  const won = p.isWinner === true;
  const content = known ? (
    <>
      <span className="tabular w-5 shrink-0 text-center text-xs text-muted">{p.seed ?? ''}</span>
      {mine && <Star className="size-3.5 shrink-0 fill-current text-accent" aria-hidden />}
      <span className={cn('min-w-0 flex-1 truncate text-left text-sm', won ? 'font-bold' : p.isWinner === false ? 'text-muted' : 'font-medium')}>
        {p.name}
        {p.tag && <span className="tabular ml-1 text-xs text-muted">[{p.tag}]</span>}
      </span>
      {p.isBye && <Badge tone="neutral">Bye</Badge>}
      {p.status !== 'ACTIVE' && <StatusPill status={p.status} />}
      {won && <Trophy className="size-4 shrink-0 text-gold-soft-text" aria-hidden />}
      <span className={cn('tabular w-5 shrink-0 text-right text-sm', !won && 'text-muted')}>{p.score ?? '–'}</span>
    </>
  ) : (
    <span className="truncate text-sm italic text-muted">{slotText(p)}</span>
  );
  const className = cn('flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1', mine ? 'bg-accent-soft' : 'bg-surface-2', selected && 'ring-2 ring-accent');
  const extra = known ? getSlotProps?.(p, match) : undefined;

  if (known && onSlotClick) {
    return (
      <div className="relative z-10 flex items-center gap-1">
        <button
          type="button"
          {...extra}
          data-slot-registration={p.registrationId}
          aria-pressed={selected}
          aria-label={`${p.name}${p.seed !== null ? `, cabeça de chave ${p.seed}` : ''}${selected ? ', selecionado para troca' : ''}`}
          onClick={() => onSlotClick(p.registrationId as string, match)}
          className={cn(className, 'min-h-11 hover:bg-neutral-soft')}
        >
          {content}
        </button>
        {renderSlotAction?.(p, match)}
      </div>
    );
  }
  return (
    <div className={cn(known && renderSlotAction ? 'relative z-10 flex items-center gap-1' : undefined)}>
      <div {...extra} data-slot-registration={p.registrationId ?? undefined} className={className}>
        {content}
      </div>
      {known && renderSlotAction?.(p, match)}
    </div>
  );
}

/**
 * Um confronto em lista (chave no celular e formatos sem árvore). O cartão inteiro abre o
 * detalhe; o nome acessível traz rodada, lados, horário com fuso e status.
 */
export function MatchRow({ match, highlightRegistrationId, onSelect, showRoundLabel, ...slots }: MatchRowProps) {
  const mine = participantOf(match, highlightRegistrationId);
  const lobby = match.kind === 'LOBBY';
  const booyah = lobby && isConcluded(match) ? match.participants.find((p) => p.placement === 1) : undefined;

  return (
    <div
      className={cn('relative flex flex-col gap-2 rounded-lg border bg-surface p-3 shadow-sm', mine ? 'border-2 border-accent' : 'border-border')}
      data-testid="bracket-match"
      data-highlight={mine ? 'true' : undefined}
      data-status={match.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          data-bracket-match={match.id}
          aria-label={matchAriaLabel(match, { highlightRegistrationId })}
          onClick={() => onSelect(match)}
          className="min-w-0 text-left text-xs text-muted after:absolute after:inset-0 after:rounded-lg"
        >
          {showRoundLabel && <span className="block text-sm font-semibold text-text">{[match.groupName, match.roundLabel].filter(Boolean).join(' · ')}</span>}
          {scheduleText(match)}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {mine && <Badge tone="accent">{lobby ? 'Sua queda' : 'Seu confronto'}</Badge>}
          <StatusPill status={match.status} label={MATCH_STATUS_PILL_LABEL[match.status]} />
        </div>
      </div>

      {lobby ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted">
            {match.participants.length} {match.participants.length === 1 ? 'equipe' : 'equipes'} na sala
            {match.multiplier > 1 ? ` · vale ×${match.multiplier.toLocaleString('pt-BR')}` : ''}
          </p>
          {booyah && (
            <p className="flex items-center gap-1.5 font-semibold">
              <Trophy className="size-4 shrink-0 text-gold-soft-text" aria-hidden />
              Booyah: {booyah.name}
            </p>
          )}
          {mine && isConcluded(match) && !mine.absent && (
            <p>
              Seu squad: {mine.placement ?? '–'}º · {mine.kills ?? 0} kills · {mine.points ?? 0} pts
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {match.participants.map((p, i) => (
            <Side
              key={p.registrationId ?? `vaga-${i}`}
              p={p}
              match={match}
              mine={p.registrationId !== null && p.registrationId === highlightRegistrationId}
              selected={p.registrationId !== null && p.registrationId === slots.selectedRegistrationId}
              {...slots}
            />
          ))}
        </div>
      )}
    </div>
  );
}
