'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@nova/ui';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface MoveContextValue {
  ids: string[];
  moveByButton: (id: string, direction: 'up' | 'down') => void;
  isLocked?: (id: string) => boolean;
  itemName: (id: string) => string;
}
const MoveContext = createContext<MoveContextValue | null>(null);

interface SortableListProps {
  /** Identificadores estáveis dos itens, na ordem atual. */
  ids: string[];
  /** Nome de cada item para leitores de tela ("Regra 2", "Confronto direto"). */
  itemName: (id: string) => string;
  onMove: (from: number, to: number) => void;
  /** Itens que não saem do lugar (nem recebem outro por cima). */
  isLocked?: (id: string) => boolean;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

interface PendingFocus {
  id: string;
  direction: 'up' | 'down';
}

/**
 * Lista reordenável: arrastar (mouse, toque e teclado pelo dnd-kit) ou os botões "subir" e "descer"
 * de cada item. Toda mudança de posição é anunciada para leitores de tela.
 */
export function SortableList({ ids, itemName, onMove, isLocked, children, className, 'aria-label': ariaLabel }: SortableListProps) {
  const dndId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [status, setStatus] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Depois de mover pelo botão, o foco continua no item movido (no outro botão, se aquele ficou desabilitado).
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-move]') ?? []);
    const find = (direction: 'up' | 'down') => buttons.find((b) => b.dataset.sortableItem === pending.id && b.dataset.move === direction && !b.disabled);
    (find(pending.direction) ?? find(pending.direction === 'up' ? 'down' : 'up'))?.focus();
  });

  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${itemName(String(active.id))} selecionado, na posição ${position(active.id)} de ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${itemName(String(active.id))} sobre a posição ${position(over.id)} de ${ids.length}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${itemName(String(active.id))} solto na posição ${position(over.id)} de ${ids.length}.` : `${itemName(String(active.id))} solto.`),
    onDragCancel: ({ active }) => `Reordenação cancelada. ${itemName(String(active.id))} voltou para a posição ${position(active.id)}.`,
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    if (isLocked?.(String(over.id))) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  }

  function moveByButton(id: string, direction: 'up' | 'down') {
    const from = ids.indexOf(id);
    const to = direction === 'up' ? from - 1 : from + 1;
    const target = ids[to];
    if (from < 0 || target === undefined || isLocked?.(target)) return;
    pendingFocus.current = { id, direction };
    setStatus(`${itemName(id)} movido para a posição ${to + 1} de ${ids.length}.`);
    onMove(from, to);
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'Para reordenar, pressione espaço ou Enter, use as setas para mover e pressione espaço ou Enter de novo para soltar. Esc cancela.',
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <MoveContext.Provider value={{ ids, moveByButton, isLocked, itemName }}>
          <ul ref={listRef} className={cn('flex flex-col gap-2', className)} aria-label={ariaLabel}>
            {children}
          </ul>
        </MoveContext.Provider>
      </SortableContext>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </DndContext>
  );
}

interface SortableItemProps {
  id: string;
  /** Recebe os controles de ordem (alça de arrastar + subir/descer) para pôr onde quiser no item. */
  children: (controls: ReactNode) => ReactNode;
  /** Em telas estreitas mostra só "subir" e "descer" (a alça de arrastar aparece a partir de 768 px). */
  compact?: boolean;
  className?: string;
}

const controlButton =
  'flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text md:size-8 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40';

export function SortableItem({ id, children, compact, className }: SortableItemProps) {
  const context = useContext(MoveContext);
  if (!context) throw new Error('SortableItem precisa estar dentro de <SortableList>.');
  const { ids, moveByButton, isLocked, itemName } = context;
  const locked = isLocked?.(id) ?? false;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: locked,
    attributes: { roleDescription: 'item reordenável' },
  });

  const index = ids.indexOf(id);
  const name = itemName(id);
  const blocked = (neighbor: string | undefined) => neighbor === undefined || (isLocked?.(neighbor) ?? false);

  const controls = locked ? null : (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Arrastar ${name} para reordenar`}
        className={cn(controlButton, 'cursor-grab touch-none active:cursor-grabbing', compact && 'hidden md:flex')}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <button type="button" data-sortable-item={id} data-move="up" aria-label={`Subir ${name}`} disabled={blocked(ids[index - 1])} onClick={() => moveByButton(id, 'up')} className={controlButton}>
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button type="button" data-sortable-item={id} data-move="down" aria-label={`Descer ${name}`} disabled={blocked(ids[index + 1])} onClick={() => moveByButton(id, 'down')} className={controlButton}>
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </span>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rounded-lg border border-border bg-surface', isDragging && 'relative z-10 shadow-md', className)}
    >
      {children(controls)}
    </li>
  );
}
