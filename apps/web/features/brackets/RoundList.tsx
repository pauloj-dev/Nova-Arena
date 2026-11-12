'use client';

import type { Match } from '@nova/schemas';
import { Tabs } from '@nova/ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { MatchRow } from './MatchRow';
import { defaultRound, type RoundGroup } from './rounds';
import type { SlotExtension } from './types';

/** Setas ↑ ↓ (e Home/End) andam entre os confrontos da lista; Enter abre o detalhe (é um botão). */
export function onListKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const target = event.target as HTMLElement;
  if (!target.matches('[data-bracket-match]')) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-bracket-match]')];
  const index = items.indexOf(target);
  const next = event.key === 'ArrowDown' ? items[index + 1] : event.key === 'ArrowUp' ? items[index - 1] : event.key === 'Home' ? items[0] : items[items.length - 1];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export interface RoundTabsProps extends SlotExtension {
  rounds: RoundGroup[];
  /** Nome acessível do conjunto de abas (ex.: "Rodadas da chave"). */
  label: string;
  highlightRegistrationId?: string | null;
  onSelect: (match: Match) => void;
  /** Conteúdo de uma rodada. Padrão: a lista simples de confrontos. */
  renderRound?: (round: RoundGroup) => ReactNode;
}

export function MatchList({ matches, label, highlightRegistrationId, onSelect, showRoundLabel, ...slots }: { matches: Match[]; label: string; highlightRegistrationId?: string | null; onSelect: (match: Match) => void; showRoundLabel?: boolean } & SlotExtension) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={label}>
      {matches.map((match) => (
        <li key={match.id}>
          <MatchRow match={match} highlightRegistrationId={highlightRegistrationId} onSelect={onSelect} showRoundLabel={showRoundLabel} {...slots} />
        </li>
      ))}
    </ul>
  );
}

/** Uma aba por rodada. A que abre primeiro é a do confronto pendente de quem está vendo. */
export function RoundTabs({ rounds, label, highlightRegistrationId, onSelect, renderRound, ...slots }: RoundTabsProps) {
  if (rounds.length === 0) return null;
  const content = (round: RoundGroup) =>
    renderRound ? (
      renderRound(round)
    ) : (
      <MatchList
        matches={round.matches}
        label={`Confrontos: ${round.label}`}
        highlightRegistrationId={highlightRegistrationId}
        onSelect={onSelect}
        showRoundLabel={round.matches.some((m) => m.roundLabel !== round.label)}
        {...slots}
      />
    );
  return (
    // Só captura as setas quando o foco está em um confronto; o resto segue o comportamento normal.
    <div onKeyDown={onListKeyDown}>
      {rounds.length === 1 && rounds[0] ? (
        <section className="flex flex-col gap-3">
          <h4 className="text-base">{rounds[0].label}</h4>
          {content(rounds[0])}
        </section>
      ) : (
        <Tabs label={label} defaultValue={defaultRound(rounds, highlightRegistrationId)} items={rounds.map((round) => ({ value: round.key, label: round.label, content: content(round) }))} />
      )}
    </div>
  );
}
