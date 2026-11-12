'use client';

import type { Match } from '@nova/schemas';
import { Tabs } from '@nova/ui';
import { useMemo, useState } from 'react';
import { columnsOf, computeBracketLayout, shortRoundLabel } from './layout';
import { MatchSummary } from './MatchSummary';
import { hasParticipant, matchAriaLabel } from './matchText';

const DONE = new Set(['VALIDATED', 'WALKOVER', 'CANCELLED']);

/** Celular: uma aba por rodada, com as partidas em lista (texto completo, nada truncado). */
export function BracketRoundList({ matches, label, highlightRegistrationId, onSelectMatch }: { matches: Match[]; label: string; highlightRegistrationId?: string | null; onSelectMatch?: (match: Match) => void }) {
  const rounds = useMemo(() => {
    const layout = computeBracketLayout(matches);
    const isDouble = layout.boxes.some((b) => b.section === 'LOSERS');
    return columnsOf(layout).map((lane, i) => {
      const first = lane[0];
      const main = lane.find((b) => b.match.bracket !== 'THIRD_PLACE') ?? first;
      const short = main ? shortRoundLabel(main.match.roundLabel) : `Rodada ${i + 1}`;
      const prefix = isDouble && main ? (main.section === 'LOSERS' ? 'Inferior: ' : main.section === 'WINNERS' ? 'Superior: ' : '') : '';
      return { value: `r${i}`, label: `${prefix}${short}`, matches: lane.map((b) => b.match) };
    });
  }, [matches]);

  // Aba inicial: a rodada da próxima partida do participante destacado; senão, a primeira rodada em aberto.
  const initial = useMemo(() => {
    const mine = rounds.find((r) => r.matches.some((m) => hasParticipant(m, highlightRegistrationId) && !DONE.has(m.status)));
    const open = rounds.find((r) => r.matches.some((m) => !DONE.has(m.status)));
    return (mine ?? open ?? rounds[rounds.length - 1])?.value ?? 'r0';
  }, [rounds, highlightRegistrationId]);
  const [tab, setTab] = useState<string | null>(null);
  const value = tab && rounds.some((r) => r.value === tab) ? tab : initial;

  return (
    <Tabs
      label={label}
      value={value}
      onValueChange={setTab}
      items={rounds.map((r) => ({
        value: r.value,
        label: r.label,
        content: (
          <ol className="flex flex-col gap-3" aria-label={r.label}>
            {r.matches.map((m) => {
              const sameRound = r.matches.filter((x) => x.bracket === m.bracket);
              const index = sameRound.length > 1 ? sameRound.indexOf(m) + 1 : undefined;
              const title = `${m.roundLabel}${index ? ` · Jogo ${index}` : ''}`;
              return (
                <li key={m.id}>
                  {onSelectMatch ? (
                    <button type="button" className="block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label={matchAriaLabel(m, { index })} onClick={() => onSelectMatch(m)}>
                      <MatchSummary match={m} title={title} highlightRegistrationId={highlightRegistrationId} />
                    </button>
                  ) : (
                    <MatchSummary match={m} title={title} highlightRegistrationId={highlightRegistrationId} />
                  )}
                </li>
              );
            })}
          </ol>
        ),
      }))}
    />
  );
}
