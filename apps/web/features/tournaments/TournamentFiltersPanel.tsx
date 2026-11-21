'use client';

import type { Game } from '@nova/schemas';
import { Button, Checkbox, Input, Select } from '@nova/ui';
import { FilterX } from 'lucide-react';
import { useT } from '@/shared/i18n/react';
import { countActiveFilters, MODE_VALUES, STATUS_VALUES, type ListFilters, type ModeFilter, type StatusFilter } from './filters';
import { messages } from './messages';

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
  const t = useT(messages, 'TournamentFiltersPanel');
  // O jogo da URL aparece mesmo antes do catálogo carregar (ou se o jogo foi desativado).
  const gameOptions = (games ?? []).map((g) => ({ value: g.slug, label: `${g.icon} ${g.name}` }));
  if (filters.game && !gameOptions.some((o) => o.value === filters.game)) gameOptions.push({ value: filters.game, label: filters.game });
  const modeOptions = MODE_VALUES.map((value) => ({ value, label: t('opcaoModo', { modo: value }) }));
  const statusOptions = STATUS_VALUES.map((value) => ({ value, label: t('opcaoStatus', { status: value }) }));
  const active = countActiveFilters(filters);

  return (
    <div className="flex flex-col gap-4">
      <Select label={t('jogo')} placeholder={t('todosOsJogos')} options={gameOptions} value={filters.game} onChange={(e) => onChange({ game: e.target.value })} />
      <Select label={t('modo')} placeholder={t('soloEEquipe')} options={modeOptions} value={filters.mode} onChange={(e) => onChange({ mode: e.target.value as ModeFilter })} />
      <Select label={t('status')} placeholder={t('todos')} options={statusOptions} value={filters.status} onChange={(e) => onChange({ status: e.target.value as StatusFilter })} />
      <Input label={t('comecaAPartirDe')} type="date" value={filters.from} onChange={(e) => onChange({ from: e.target.value })} />
      <div className="flex flex-col">
        <Checkbox label={t('soComVagas')} hint={t('soComVagasDica')} checked={filters.slots} onCheckedChange={(slots) => onChange({ slots })} />
        <Checkbox label={t('soVerificado')} checked={filters.verified} onCheckedChange={(verified) => onChange({ verified })} />
      </div>
      {!hideClear && (
        <Button variant="ghost" onClick={onClear} disabled={active === 0} iconLeft={<FilterX className="size-4" aria-hidden />}>
          {t('limparFiltros')}
        </Button>
      )}
    </div>
  );
}
