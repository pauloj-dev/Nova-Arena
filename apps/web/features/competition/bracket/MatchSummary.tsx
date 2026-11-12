'use client';

import type { Match, MatchParticipant } from '@nova/schemas';
import { Badge, cn } from '@nova/ui';
import { Check } from 'lucide-react';
import { formatDateTime } from '@/shared/lib/datetime';
import { hasParticipant, isPlaceholder, matchState, participantName, participantNote, type MatchTone } from './matchText';

const toneClass: Record<MatchTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-soft-text',
  info: 'bg-info-soft text-info-soft-text',
  primary: 'bg-primary-soft text-primary-soft-text',
  warning: 'bg-warning-soft text-warning-soft-text',
  danger: 'bg-danger-soft text-danger-soft-text',
};

export function MatchStateBadge({ match }: { match: Pick<Match, 'status' | 'waitingPrevious'> }) {
  const state = matchState(match);
  const Icon = state.icon;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', toneClass[state.tone])}>
      {state.live ? <span className="size-2 rounded-full bg-primary-500 animate-pulse-live" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
      {state.label}
    </span>
  );
}

function Side({ p, mine }: { p: MatchParticipant | undefined; mine: boolean }) {
  const winner = Boolean(p?.isWinner && p.registrationId);
  const note = participantNote(p);
  return (
    <li className={cn('flex min-h-10 items-center gap-2 px-3 py-1.5', mine && 'bg-accent-soft text-accent-soft-text')}>
      {p?.seed != null && <span className="tabular w-5 shrink-0 text-xs text-muted">{p.seed}</span>}
      <span className={cn('min-w-0 flex-1 break-words', winner && 'font-bold', isPlaceholder(p) && 'text-muted italic', note && 'line-through')}>
        {participantName(p)}
        {p?.tag && <span className="ml-1 text-xs text-muted not-italic">[{p.tag}]</span>}
      </span>
      {note && <span className="text-xs text-muted">({note})</span>}
      {mine && (
        <Badge tone="accent" className="shrink-0">
          Você
        </Badge>
      )}
      {winner && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary-text">
          <Check className="size-3.5" aria-hidden />
          Venceu
        </span>
      )}
      <span className={cn('tabular w-6 shrink-0 text-right', winner ? 'font-bold' : 'text-muted')}>{p?.score ?? (p?.isBye ? '' : '–')}</span>
    </li>
  );
}

/**
 * Uma partida em HTML: usada na lista por rodada do celular e no painel de detalhes do desktop.
 * O texto completo fica visível (nada truncado), com o estado em ícone + texto.
 */
export function MatchSummary({ match, highlightRegistrationId, title, className }: { match: Match; highlightRegistrationId?: string | null; title?: string; className?: string }) {
  const mine = hasParticipant(match, highlightRegistrationId);
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-surface', mine ? 'border-accent ring-1 ring-accent' : 'border-border', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2 text-xs">
        <span className="font-semibold text-text">
          {title ?? match.roundLabel}
          {match.bestOf > 1 && <span className="font-normal text-muted"> · MD{match.bestOf}</span>}
          {match.ifNecessary && <span className="font-normal text-muted"> · se necessária</span>}
        </span>
        <MatchStateBadge match={match} />
      </div>
      <ul className="divide-y divide-border text-sm" aria-label="Participantes">
        {[0, 1].map((i) => (
          <Side key={i} p={match.participants[i]} mine={Boolean(highlightRegistrationId) && match.participants[i]?.registrationId === highlightRegistrationId} />
        ))}
      </ul>
      <p className="border-t border-border px-3 py-2 text-xs text-muted">{match.scheduledAt ? formatDateTime(match.scheduledAt) : 'Horário a definir'}</p>
    </div>
  );
}
