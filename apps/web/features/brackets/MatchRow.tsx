'use client';

import type { Match, MatchParticipant } from '@nova/schemas';
import { Badge, cn, StatusPill } from '@nova/ui';
import { Star, Trophy } from 'lucide-react';
import { matchAriaLabel, MATCH_STATUS_PILL_LABEL, isConcluded, participantOf, scheduleText, slotText } from '@/features/matches/matchText';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import type { SlotExtension } from './types';

export interface MatchRowProps extends SlotExtension {
  match: Match;
  highlightRegistrationId?: string | null;
  onSelect: (match: Match) => void;
  /** Mostra o rótulo da rodada no cartão (quando a lista mistura rodadas, ex.: final + 3º lugar). */
  showRoundLabel?: boolean;
}

function Side({ p, match, mine, selected, onSlotClick, getSlotProps, renderSlotAction }: { p: MatchParticipant; match: Match; mine: boolean; selected: boolean } & SlotExtension) {
  const t = useT(messages, 'MatchRow');
  const tv = useT(messages, 'vaga');
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
      {p.isBye && <Badge tone="neutral">{t('bye')}</Badge>}
      {p.status !== 'ACTIVE' && <StatusPill status={p.status} />}
      {won && <Trophy className="size-4 shrink-0 text-gold-soft-text" aria-hidden />}
      <span className={cn('tabular w-5 shrink-0 text-right text-sm', !won && 'text-muted')}>{p.score ?? '–'}</span>
    </>
  ) : (
    <span className="truncate text-sm italic text-muted">{slotText(p)}</span>
  );
  const className = cn('flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1', mine ? 'bg-accent-soft' : 'bg-surface-2', selected && 'ring-2 ring-accent');
  const extra = known ? getSlotProps?.(p, match) : undefined;
  const slotLabel = tv('aria', { name: p.name, seeded: p.seed !== null ? 'sim' : 'nao', seed: p.seed ?? '', selected: selected ? 'sim' : 'nao' });

  if (known && onSlotClick) {
    return (
      <div className="relative z-10 flex items-center gap-1">
        <button
          type="button"
          {...extra}
          data-slot-registration={p.registrationId}
          aria-pressed={selected}
          aria-label={slotLabel}
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
  const t = useT(messages, 'MatchRow');
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
      {/*
        O cartão inteiro é o botão: uma área por cima de tudo, só com o nome acessível completo. O texto visível
        fica fora dele, para não divergir do nome (WCAG 2.5.3, rótulo no nome).
      */}
      <button
        type="button"
        data-bracket-match={match.id}
        aria-label={matchAriaLabel(match, { highlightRegistrationId })}
        onClick={() => onSelect(match)}
        className="absolute inset-0 rounded-lg"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-left text-xs text-muted">
          {showRoundLabel && <span className="block text-sm font-semibold text-text">{[match.groupName, match.roundLabel].filter(Boolean).join(' · ')}</span>}
          {scheduleText(match)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {mine && <Badge tone="accent">{lobby ? t('suaQueda') : t('seuConfronto')}</Badge>}
          <StatusPill status={match.status} label={MATCH_STATUS_PILL_LABEL[match.status]} />
        </div>
      </div>

      {lobby ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted">
            {t('naSala', { count: match.participants.length, multiplied: match.multiplier > 1 ? 'sim' : 'nao', multiplier: match.multiplier })}
          </p>
          {booyah && (
            <p className="flex items-center gap-1.5 font-semibold">
              <Trophy className="size-4 shrink-0 text-gold-soft-text" aria-hidden />
              {t('booyah', { name: booyah.name })}
            </p>
          )}
          {mine && isConcluded(match) && !mine.absent && (
            <p>
              {t('seuSquad', { placement: mine.placement ?? '–', kills: mine.kills ?? 0, points: mine.points ?? 0 })}
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
