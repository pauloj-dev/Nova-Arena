'use client';

import type { Seeding } from '@nova/schemas';
import { Button, Input, Select } from '@nova/ui';
import { ArrowDown, ArrowUp, GripVertical, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { SEEDING_INFO } from '../lib/labels';
import { moveItem, SortableList, useSortableRow } from '../stage-builder/Sortable';

export interface GenerateEntrant {
  registrationId: string;
  name: string;
}

export interface GenerateBracketFormProps {
  entrants: GenerateEntrant[];
  defaultSeeding: Seeding;
  loading: boolean;
  /** Já existe uma chave (prévia ou confirmada): gerar de novo descarta a atual. */
  regenerating: boolean;
  onGenerate: (input: { seeding: Seeding; seed?: string; order?: string[] }) => void;
  onCancel?: () => void;
}

function ManualRow({ entrant, index, total, onMove }: { entrant: GenerateEntrant; index: number; total: number; onMove: (to: number) => void }) {
  const { setNode, style, handleProps } = useSortableRow(entrant.registrationId);
  return (
    <li ref={setNode} style={style} className="flex items-center gap-2 rounded-md border border-border bg-surface p-1.5" data-testid="manual-seed">
      <button type="button" {...handleProps} aria-label={`Arrastar ${entrant.name}`} className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-md text-muted hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-accent md:size-8">
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="tabular w-6 shrink-0 text-center text-xs text-muted">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{entrant.name}</span>
      <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Subir ${entrant.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent md:size-8">
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button type="button" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`Descer ${entrant.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent md:size-8">
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** Gerar a chave (PRD §10.5): sorteio com seed opcional, por ranking ou na ordem manual (lista ordenável). */
export function GenerateBracketForm({ entrants, defaultSeeding, loading, regenerating, onGenerate, onCancel }: GenerateBracketFormProps) {
  const [seeding, setSeeding] = useState<Seeding>(defaultSeeding);
  const [seed, setSeed] = useState('');
  const [order, setOrder] = useState(entrants);

  // A lista de inscritos pode chegar depois: mantém a ordem já arrumada e acrescenta quem faltava.
  const known = new Set(order.map((e) => e.registrationId));
  const current = new Set(entrants.map((e) => e.registrationId));
  const list = [...order.filter((e) => current.has(e.registrationId)), ...entrants.filter((e) => !known.has(e.registrationId))];

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Gerar chave"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate({ seeding, ...(seeding === 'RANDOM' && seed.trim() ? { seed: seed.trim() } : {}), ...(seeding === 'MANUAL' ? { order: list.map((e) => e.registrationId) } : {}) });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Como distribuir os participantes"
          value={seeding}
          onChange={(e) => setSeeding(e.target.value as Seeding)}
          options={(['RANDOM', 'RANKED', 'MANUAL'] as const).map((value) => ({ value, label: SEEDING_INFO[value].label }))}
          hint={SEEDING_INFO[seeding].description}
        />
        {seeding === 'RANDOM' && (
          <Input label="Seed do sorteio (opcional)" value={seed} maxLength={64} onChange={(e) => setSeed(e.target.value)} placeholder="Em branco, geramos uma" hint="A mesma seed sempre gera a mesma chave. Ela fica registrada para auditoria." autoComplete="off" />
        )}
      </div>

      {seeding === 'MANUAL' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Arrume a ordem: o 1º da lista é o cabeça de chave 1. Arraste pela alça ou use as setas.</p>
          <SortableList ids={list.map((e) => e.registrationId)} labelOf={(id) => list.find((e) => e.registrationId === id)?.name ?? ''} onMove={(from, to) => setOrder(moveItem(list, from, to))}>
            <ol className="flex max-h-96 flex-col gap-1.5 overflow-y-auto" aria-label="Ordem dos participantes">
              {list.map((entrant, index) => (
                <ManualRow key={entrant.registrationId} entrant={entrant} index={index} total={list.length} onMove={(to) => setOrder(moveItem(list, index, to))} />
              ))}
            </ol>
          </SortableList>
        </div>
      )}

      {regenerating && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">Gerar de novo descarta a chave atual desta fase e registra o novo sorteio na auditoria.</p>}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Voltar
          </Button>
        )}
        <Button type="submit" loading={loading} disabled={list.length < 2} iconLeft={<Shuffle className="size-4" aria-hidden />}>
          {regenerating ? 'Gerar chave de novo' : 'Gerar chave'}
        </Button>
      </div>
      {list.length < 2 && <p className="text-sm text-muted">São necessários pelo menos 2 participantes confirmados para gerar a chave.</p>}
    </form>
  );
}
