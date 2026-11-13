'use client';

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@nova/ui';
import { GripVertical } from 'lucide-react';
import { useId } from 'react';
import type { SeedingContainer, SeedingSlot } from './stageUtils';

interface ChipProps {
  slot: SeedingSlot;
  container: string;
  selected: boolean;
  /** Há outro participante selecionado: este vira o alvo da troca. */
  target: boolean;
  disabled: boolean;
  onPick: (registrationId: string) => void;
}

function Chip({ slot, container, selected, target, disabled, onPick }: ChipProps) {
  const drag = useDraggable({ id: slot.registrationId, disabled });
  const drop = useDroppable({ id: slot.registrationId, disabled });
  const over = drop.isOver && !drag.isDragging;
  return (
    <li>
      <button
        type="button"
        ref={(node) => {
          drag.setNodeRef(node);
          drop.setNodeRef(node);
        }}
        {...drag.listeners}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`${slot.name}, ${container}${selected ? ', selecionado para a troca' : target ? '. Trocar com o selecionado' : '. Selecionar para trocar de posição'}`}
        data-testid="seed-slot"
        data-registration={slot.registrationId}
        style={{ transform: CSS.Translate.toString(drag.transform), touchAction: 'none' }}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-md border border-border bg-surface px-2 text-left text-sm text-text',
          'hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60',
          selected && 'border-accent bg-accent-soft text-accent-soft-text hover:bg-accent-soft',
          over && 'border-accent bg-accent-soft',
          drag.isDragging && 'relative z-10 cursor-grabbing shadow-lg',
        )}
        onClick={() => onPick(slot.registrationId)}
      >
        <GripVertical className="size-4 shrink-0 text-muted" aria-hidden />
        {slot.seed !== null && <span className="tabular w-5 shrink-0 text-center text-xs text-muted">{slot.seed}</span>}
        <span className="min-w-0 flex-1 truncate font-medium">
          {slot.name}
          {slot.tag && <span className="tabular ml-1 text-xs font-normal text-muted">[{slot.tag}]</span>}
        </span>
      </button>
    </li>
  );
}

export interface SeedingBoardProps {
  containers: SeedingContainer[];
  /** Participante selecionado para a troca por clique ou teclado. */
  selectedId: string | null;
  onSelect: (registrationId: string | null) => void;
  onSwap: (a: string, b: string) => void;
  disabled?: boolean;
}

/**
 * Ajuste manual da chave (US-ORG-04): arraste um participante e solte em cima de outro para
 * trocar os dois de posição. Sem arrastar: selecione um (clique, Enter ou Espaço) e depois o outro.
 */
export function SeedingBoard({ containers, selectedId, onSelect, onSwap, disabled = false }: SeedingBoardProps) {
  const id = useId();
  // Só começa a arrastar depois de 6 px: um toque simples continua sendo um clique.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function pick(registrationId: string) {
    if (selectedId === null) onSelect(registrationId);
    else if (selectedId === registrationId) onSelect(null);
    else {
      onSwap(selectedId, registrationId);
      onSelect(null);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const from = String(event.active.id);
    const to = event.over ? String(event.over.id) : null;
    if (to && to !== from) {
      onSwap(from, to);
      onSelect(null);
    }
  }

  const selectedName = containers.flatMap((c) => c.slots).find((s) => s.registrationId === selectedId)?.name;
  return (
    <div className="flex flex-col gap-3" data-testid="seeding-board">
      <p className="text-sm text-muted" role="status" aria-live="polite">
        {selectedName ? `${selectedName} selecionado. Escolha com quem trocar (ou toque nele de novo para desistir).` : 'Arraste um participante e solte em cima de outro para trocar os dois. Ou selecione um e depois o outro.'}
      </p>
      <DndContext id={id} sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
          {containers.map((container) => (
            <section key={container.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3" aria-label={container.label} data-testid="seed-container">
              <h4 className="text-sm font-semibold break-words text-text">{container.label}</h4>
              <ul className="flex flex-col gap-1.5">
                {container.slots.map((slot) => (
                  <Chip key={slot.registrationId} slot={slot} container={container.label} selected={selectedId === slot.registrationId} target={selectedId !== null && selectedId !== slot.registrationId} disabled={disabled} onPick={pick} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DndContext>
    </div>
  );
}
