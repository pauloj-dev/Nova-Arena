'use client';

import type { Seeding } from '@nova/schemas';
import { Button, Input, Select } from '@nova/ui';
import { ArrowDown, ArrowUp, GripVertical, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/shared/i18n/react';
import { SEEDING_INFO } from '../lib/labels';
import { moveItem, SortableList, useSortableRow } from '../stage-builder/Sortable';
import { messages } from './messages';

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
  const t = useT(messages, 'GenerateBracketForm');
  return (
    <li ref={setNode} style={style} className="flex items-center gap-2 rounded-md border border-border bg-surface p-1.5" data-testid="manual-seed">
      <button type="button" {...handleProps} aria-label={t('arrastar', { name: entrant.name })} className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-md text-muted hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-accent md:size-8">
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="tabular w-6 shrink-0 text-center text-xs text-muted">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{entrant.name}</span>
      <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={t('subir', { name: entrant.name })} className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent md:size-8">
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button type="button" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={t('descer', { name: entrant.name })} className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent md:size-8">
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** Gerar a chave (PRD §10.5): sorteio com seed opcional, por ranking ou na ordem manual (lista ordenável). */
export function GenerateBracketForm({ entrants, defaultSeeding, loading, regenerating, onGenerate, onCancel }: GenerateBracketFormProps) {
  const t = useT(messages, 'GenerateBracketForm');
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
      aria-label={t('formulario')}
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate({ seeding, ...(seeding === 'RANDOM' && seed.trim() ? { seed: seed.trim() } : {}), ...(seeding === 'MANUAL' ? { order: list.map((e) => e.registrationId) } : {}) });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label={t('distribuicao')}
          value={seeding}
          onChange={(e) => setSeeding(e.target.value as Seeding)}
          options={(['RANDOM', 'RANKED', 'MANUAL'] as const).map((value) => ({ value, label: SEEDING_INFO[value].label }))}
          hint={SEEDING_INFO[seeding].description}
        />
        {seeding === 'RANDOM' && (
          <Input label={t('seed')} value={seed} maxLength={64} onChange={(e) => setSeed(e.target.value)} placeholder={t('seedPlaceholder')} hint={t('seedDica')} autoComplete="off" />
        )}
      </div>

      {seeding === 'MANUAL' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t('ordemDica')}</p>
          <SortableList ids={list.map((e) => e.registrationId)} labelOf={(id) => list.find((e) => e.registrationId === id)?.name ?? ''} onMove={(from, to) => setOrder(moveItem(list, from, to))}>
            <ol className="flex max-h-96 flex-col gap-1.5 overflow-y-auto" aria-label={t('ordem')}>
              {list.map((entrant, index) => (
                <ManualRow key={entrant.registrationId} entrant={entrant} index={index} total={list.length} onMove={(to) => setOrder(moveItem(list, index, to))} />
              ))}
            </ol>
          </SortableList>
        </div>
      )}

      {regenerating && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">{t('regerarAviso')}</p>}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('voltar')}
          </Button>
        )}
        <Button type="submit" loading={loading} disabled={list.length < 2} iconLeft={<Shuffle className="size-4" aria-hidden />}>
          {regenerating ? t('gerarDeNovo') : t('gerar')}
        </Button>
      </div>
      {list.length < 2 && <p className="text-sm text-muted">{t('minimo')}</p>}
    </form>
  );
}
