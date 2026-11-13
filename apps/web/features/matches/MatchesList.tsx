'use client';

import type { Match, MatchStatus } from '@nova/schemas';
import { Button, Checkbox, EmptyState, Select, statusLabel } from '@nova/ui';
import { CalendarX } from 'lucide-react';
import { useState } from 'react';
import { formatDate, formatDateTime } from '@/shared/lib/datetime';
import { MatchCard } from './MatchCard';
import { isOver, MATCH_STATUS_PILL_LABEL, participantOf } from './matchText';
import { useNow } from './useNow';
import { useMatchViewer, type MatchViewer } from './viewer';

const STATUSES: MatchStatus[] = ['SCHEDULED', 'CHECK_IN', 'LIVE', 'AWAITING_VALIDATION', 'VALIDATED', 'DISPUTED', 'WALKOVER', 'CANCELLED'];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MatchFilters {
  stageId: string;
  status: MatchStatus | '';
  mine: boolean;
}

export const NO_FILTERS: MatchFilters = { stageId: '', status: '', mine: false };

export function filterMatches(matches: readonly Match[], filters: MatchFilters, registrationId: string | null | undefined): Match[] {
  return matches.filter(
    (m) =>
      (filters.stageId === '' || m.stageId === filters.stageId) &&
      (filters.status === '' || m.status === filters.status) &&
      (!filters.mine || (registrationId != null && m.participants.some((p) => p.registrationId === registrationId))),
  );
}

export interface DayGroup {
  /** "12/11/2026" no fuso de quem vê, ou vazio para partidas sem horário. */
  key: string;
  label: string;
  matches: Match[];
}

/** Agrupa por dia (no fuso de quem vê), em ordem de horário. Partidas sem horário ficam por último. */
export function groupByDay(matches: readonly Match[], now: number, timeZone?: string): DayGroup[] {
  const zone = timeZone ? { timeZone } : undefined;
  const today = formatDate(new Date(now).toISOString(), zone);
  const tomorrow = formatDate(new Date(now + DAY_MS).toISOString(), zone);
  const yesterday = formatDate(new Date(now - DAY_MS).toISOString(), zone);
  const sorted = [...matches].sort((a, b) => {
    if (a.scheduledAt && b.scheduledAt) return a.scheduledAt.localeCompare(b.scheduledAt) || a.round - b.round || a.position - b.position;
    if (a.scheduledAt) return -1;
    if (b.scheduledAt) return 1;
    return a.stageId.localeCompare(b.stageId) || a.round - b.round || a.position - b.position;
  });
  const groups: DayGroup[] = [];
  for (const match of sorted) {
    const key = match.scheduledAt ? formatDate(match.scheduledAt, zone) : '';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const day = match.scheduledAt ? (formatDateTime(match.scheduledAt, { ...zone, withZone: false }).split(' · ')[0] ?? key) : '';
      const relative = key === today ? 'Hoje · ' : key === tomorrow ? 'Amanhã · ' : key === yesterday ? 'Ontem · ' : '';
      group = { key, label: match.scheduledAt ? `${relative}${day}` : 'Sem horário definido', matches: [] };
      groups.push(group);
    }
    group.matches.push(match);
  }
  return groups;
}

export interface MatchesListProps {
  matches: readonly Match[];
  /** Fases do campeonato, para o filtro (some quando há só uma). */
  stages: { id: string; name: string }[];
  viewer?: MatchViewer;
  onOpen: (match: Match) => void;
}

/** Lista de partidas do campeonato, agrupada por dia, com filtros por fase, status e "minhas partidas". */
export function MatchesList({ matches, stages, viewer: viewerProp, onOpen }: MatchesListProps) {
  const contextViewer = useMatchViewer();
  const viewer = viewerProp ?? contextViewer;
  const [filters, setFilters] = useState<MatchFilters>(NO_FILTERS);
  const now = useNow(60_000);
  const registrationId = viewer.registration?.id;
  const visible = filterMatches(matches, filters, registrationId);
  const days = groupByDay(visible, now);
  const filtering = filters.stageId !== '' || filters.status !== '' || filters.mine;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-end gap-3 xs:grid-cols-2 md:flex md:flex-wrap" role="group" aria-label="Filtros das partidas">
        {stages.length > 1 && (
          <Select
            label="Fase"
            className="md:w-56"
            value={filters.stageId}
            onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value }))}
            options={[{ value: '', label: 'Todas as fases' }, ...stages.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
        <Select
          label="Status"
          className="md:w-56"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as MatchStatus | '' }))}
          options={[{ value: '', label: 'Todos os status' }, ...STATUSES.map((s) => ({ value: s, label: MATCH_STATUS_PILL_LABEL[s] ?? statusLabel(s) }))]}
        />
        {registrationId && <Checkbox label="Só as minhas partidas" checked={filters.mine} onCheckedChange={(mine) => setFilters((f) => ({ ...f, mine }))} className="min-h-11 xs:col-span-2" />}
      </div>

      <p className="text-sm text-muted" role="status">
        {visible.length} {visible.length === 1 ? 'partida' : 'partidas'}
        {filtering ? ` de ${matches.length}` : ''}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          icon={<CalendarX className="size-7" />}
          title={filtering ? 'Nenhuma partida com esses filtros' : 'Nenhuma partida ainda'}
          description={filtering ? 'Mude os filtros para ver outras partidas.' : 'As partidas aparecem aqui quando a chave for confirmada.'}
          action={
            filtering ? (
              <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        days.map((day) => (
          <section key={day.key || 'sem-horario'} className="flex flex-col gap-3" aria-label={day.label}>
            <h3 className="text-base">{day.label}</h3>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {day.matches.map((match) => {
                // A partida que a pessoa ainda vai jogar aparece inteira (check-in e sala à mão); as outras, resumidas.
                const mineOpen = Boolean(participantOf(match, registrationId)) && !isOver(match);
                return (
                  <li key={match.id}>
                    <MatchCard match={match} viewer={viewer} variant={mineOpen ? 'full' : 'compact'} onOpen={onOpen} headingLevel={4} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
