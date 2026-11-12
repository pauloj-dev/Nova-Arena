'use client';

import { Button, Input } from '@nova/ui';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { NumberField } from './NumberField';
import { fillPlacements, LEAGUE_TABLE } from './rules';

interface Row {
  id: number;
  key: string;
  points: number;
}

let rowSeq = 0;
const newRow = (key: string, points: number): Row => ({ id: (rowSeq += 1), key, points });

/** "01" e " 1 " viram "1": é assim que o motor procura o valor na tabela. */
function normalizeKey(key: string): string {
  const trimmed = key.trim();
  const numeric = Number(trimmed);
  return trimmed !== '' && Number.isFinite(numeric) ? String(numeric) : trimmed;
}

function compareKeys(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, 'pt-BR');
}

function rowsFromTable(table: Record<string, number>): Row[] {
  return Object.entries(table)
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([key, points]) => newRow(key, points));
}

/** Linhas sem valor ficam só na tela; valor repetido vale o da última linha. */
function tableFromRows(rows: Row[]): Record<string, number> {
  const table: Record<string, number> = {};
  for (const row of rows) {
    const key = normalizeKey(row.key);
    if (key !== '') table[key] = row.points;
  }
  return table;
}

function sameTable(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

interface TableRuleFieldsProps {
  table: Record<string, number>;
  onChange: (table: Record<string, number>) => void;
  /** Tabela de colocação: ganha os atalhos "1º a N" e "tabela de liga". */
  placement: boolean;
  /** Nome da estatística no plural, para os rótulos ("kills", "gols"). */
  statName: string;
}

/** Linhas "valor → pontos" de uma regra do tipo tabela. */
export function TableRuleFields({ table, onChange, placement, statName }: TableRuleFieldsProps) {
  const [rows, setRows] = useState(() => rowsFromTable(table));
  const [fillCount, setFillCount] = useState(12);

  // A tabela mudou por fora (atalho, outra pessoa editando o rascunho): as linhas acompanham.
  if (!sameTable(tableFromRows(rows), table)) setRows(rowsFromTable(table));

  function commit(next: Row[]) {
    setRows(next);
    const nextTable = tableFromRows(next);
    if (!sameTable(nextTable, table)) onChange(nextTable);
  }

  function addRow() {
    const numeric = rows.map((row) => Number(normalizeKey(row.key))).filter((n) => Number.isFinite(n));
    const key = String(numeric.length > 0 ? Math.max(...numeric) + 1 : 1);
    commit([...rows, newRow(key, 0)]);
  }

  const keyCount = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeKey(row.key);
    if (key !== '') keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }
  const keyHeader = placement ? 'Colocação' : `Valor de ${statName}`;

  return (
    <div className="flex flex-col gap-3 md:col-span-2">
      {placement && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <NumberField label="Preencher do 1º ao" value={fillCount} onChange={(n) => setFillCount(Math.max(1, Math.min(100, Math.floor(n))))} min={1} max={100} className="w-36" />
            <Button variant="secondary" size="sm" onClick={() => onChange(fillPlacements(table, fillCount))}>
              Preencher colocações
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onChange({ ...LEAGUE_TABLE })}>
              Usar tabela de liga
            </Button>
          </div>
          <p className="text-xs text-muted">Tabela de liga: 12 / 9 / 8 / 7 / 6 / 5 / 4 / 3 / 2 / 1 e zero do 11º em diante.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 text-xs font-semibold text-muted" aria-hidden>
          <span>{keyHeader}</span>
          <span>Pontos</span>
          <span />
        </div>
        {rows.length === 0 && <p className="text-sm text-muted">Nenhuma linha ainda. Adicione a primeira.</p>}
        {rows.map((row, i) => {
          const key = normalizeKey(row.key);
          const repeated = key !== '' && (keyCount.get(key) ?? 0) > 1;
          const pointsLabel = placement && key !== '' ? `Pontos do ${key}º lugar` : key !== '' ? `Pontos para ${statName} = ${key}` : `Pontos da linha ${i + 1}`;
          return (
            <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-start gap-2">
              <Input
                label={`${keyHeader} (linha ${i + 1})`}
                hideLabel
                inputMode="numeric"
                autoComplete="off"
                value={row.key}
                error={repeated ? 'Valor repetido' : undefined}
                onChange={(event) => commit(rows.map((r) => (r.id === row.id ? { ...r, key: event.target.value } : r)))}
              />
              <NumberField label={pointsLabel} hideLabel step="any" value={row.points} onChange={(points) => commit(rows.map((r) => (r.id === row.id ? { ...r, points } : r)))} />
              <button
                type="button"
                aria-label={`Remover linha ${i + 1}`}
                onClick={() => commit(rows.filter((r) => r.id !== row.id))}
                className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
        <div>
          <Button variant="ghost" size="sm" onClick={addRow} iconLeft={<Plus className="size-4" aria-hidden />}>
            Adicionar linha
          </Button>
        </div>
      </div>
    </div>
  );
}
