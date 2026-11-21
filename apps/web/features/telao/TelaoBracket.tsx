'use client';

import type { Match, MatchParticipant } from '@nova/schemas';
import { cn, StatusPill } from '@nova/ui';
import { Trophy } from 'lucide-react';
import type { CSSProperties } from 'react';
import { MATCH_STATUS_PILL_LABEL, isConcluded, slotText } from '@/features/matches/matchText';
import type { BracketPage } from './telao';

function DuelSide({ p }: { p: MatchParticipant }) {
  const known = p.registrationId !== null;
  const won = p.isWinner === true;
  return (
    <div className={cn('flex min-h-12 items-center gap-3 rounded-md px-3 py-1.5 md:min-h-14', won ? 'bg-accent-soft text-accent-soft-text' : 'bg-surface-2')}>
      <span className={cn('min-w-0 flex-1 truncate text-lg md:text-2xl', won ? 'font-bold' : p.isWinner === false ? 'text-muted' : 'font-semibold', !known && 'italic text-muted')}>
        {known ? p.name : slotText(p)}
      </span>
      {won && (
        <>
          <Trophy className="size-5 shrink-0 md:size-6" aria-hidden />
          <span className="sr-only">vencedor</span>
        </>
      )}
      <span className={cn('tabular w-10 shrink-0 text-right text-xl md:text-3xl', won ? 'font-bold' : 'text-muted')}>{p.isBye ? '' : (p.score ?? '–')}</span>
    </div>
  );
}

function LobbyBody({ match }: { match: Match }) {
  const booyah = match.participants.find((p) => p.placement === 1 && !p.absent);
  const present = match.participants.filter((p) => p.registrationId !== null);
  return (
    <div className="flex flex-col gap-1 text-lg md:text-2xl">
      <p className="text-muted">{present.length} squads na sala</p>
      {isConcluded(match) && booyah && (
        <p className="flex items-center gap-2 font-semibold">
          <Trophy className="size-5 shrink-0 text-gold-soft-text md:size-6" aria-hidden />
          Booyah: <span className="truncate">{booyah.name}</span>
        </p>
      )}
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 md:p-3" data-testid="telao-partida">
      <div className="flex items-center justify-between gap-2 text-sm text-muted md:text-base">
        <span className="truncate">{match.kind === 'LOBBY' ? (match.groupName ?? match.roundLabel) : match.bestOf > 1 ? `MD${match.bestOf}` : ''}</span>
        <StatusPill status={match.status} label={MATCH_STATUS_PILL_LABEL[match.status]} />
      </div>
      {match.kind === 'LOBBY' ? <LobbyBody match={match} /> : match.participants.map((p, i) => <DuelSide key={p.registrationId ?? `vaga-${i}`} p={p} />)}
    </li>
  );
}

export interface TelaoBracketProps {
  page: BracketPage;
  transparent: boolean;
}

/** Uma página da chave: rodadas lado a lado (mata-mata) ou os confrontos de um grupo/sala. */
export function TelaoBracket({ page, transparent }: TelaoBracketProps) {
  const single = page.columns.length === 1;
  return (
    <div className={cn('grid min-h-0 flex-1 gap-4 md:gap-6', !single && 'md:grid-cols-[repeat(var(--cols),minmax(0,1fr))]', transparent && 'rounded-xl bg-surface/90 p-3 shadow-lg')} style={{ '--cols': page.columns.length } as CSSProperties} data-testid="telao-chave">
      {page.columns.map((column) => (
        <section key={column.key} aria-label={column.label} className="flex min-w-0 flex-col gap-3">
          {!single && <h2 className="text-xl text-muted md:text-2xl">{column.label}</h2>}
          <ul className={cn('grid gap-3', single ? 'md:grid-cols-2' : 'content-around flex-1')}>
            {column.matches.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
