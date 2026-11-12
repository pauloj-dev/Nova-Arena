'use client';

import type { Game } from '@nova/schemas';
import { Button, Checkbox, Input, Select } from '@nova/ui';
import { FilterX } from 'lucide-react';
import { countActiveFilters, MODE_OPTIONS, STATUS_OPTIONS, type ListFilters, type ModeFilter, type StatusFilter } from './filters';

interface TournamentFiltersPanelProps {
  filters: ListFilters;
  games: Game[] | undefined;
  onChange: (patch: Partial<ListFilters>) => void;
  onClear: () => void;
  /** Esconde o botão "Limpar filtros" (no drawer ele fica no rodapé). */
  hideClear?: boolean;
}

/** Campos de filtro da lista. Os mesmos na barra lateral (desktop) e no drawer (celular). */
export function TournamentFiltersPanel({ filters, games, onChange, onClear, hideClear = false }: TournamentFiltersPanelProps) {
  // O jogo da URL aparece mesmo antes do catálogo carregar (ou se o jogo foi desativado).
  const gameOptions = (games ?? []).map((g) => ({ value: g.slug, label: `${g.icon} ${g.name}` }));
  if (filters.game && !gameOptions.some((o) => o.value === filters.game)) gameOptions.push({ value: filters.game, label: filters.game });
  const active = countActiveFilters(filters);

  return (
    <div className="flex flex-col gap-4">
      <Select label="Jogo" placeholder="Todos os jogos" options={gameOptions} value={filters.game} onChange={(e) => onChange({ game: e.target.value })} />
      <Select label="Modo" placeholder="Solo e equipe" options={MODE_OPTIONS} value={filters.mode} onChange={(e) => onChange({ mode: e.target.value as ModeFilter })} />
      <Select label="Status" placeholder="Todos" options={STATUS_OPTIONS} value={filters.status} onChange={(e) => onChange({ status: e.target.value as StatusFilter })} />
      <Input label="Começa a partir de" type="date" value={filters.from} onChange={(e) => onChange({ from: e.target.value })} />
      <div className="flex flex-col">
        <Checkbox label="Só com vagas" hint="Inscrições abertas e vaga livre." checked={filters.slots} onCheckedChange={(slots) => onChange({ slots })} />
        <Checkbox label="Só organizador verificado" checked={filters.verified} onCheckedChange={(verified) => onChange({ verified })} />
      </div>
      {!hideClear && (
        <Button variant="ghost" onClick={onClear} disabled={active === 0} iconLeft={<FilterX className="size-4" aria-hidden />}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
