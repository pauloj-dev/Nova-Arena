'use client';

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { restrictToVerticalAxis } from './modifiers';

interface SortableListProps {
  /** Identificadores dos itens, na ordem atual. */
  ids: string[];
  /** Nome de cada item, para os avisos do leitor de tela. */
  labelOf: (id: string) => string;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}

/** Lista reordenável por arrastar (mouse, toque e teclado). Quem usa oferece também botões "mover para cima/baixo". */
export function SortableList({ ids, labelOf, onMove, children }: SortableListProps) {
  const id = useId();
  const sensors = useSensors(
    // Só começa a arrastar depois de 6 px: um toque simples continua sendo um clique.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const position = (itemId: string | number) => ids.indexOf(String(itemId)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(String(active.id))} selecionado. Posição ${position(active.id)} de ${ids.length}. Use as setas para mover e Espaço para soltar.`,
    onDragOver: ({ active, over }) => (over ? `${labelOf(String(active.id))} foi para a posição ${position(over.id)} de ${ids.length}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${labelOf(String(active.id))} solto na posição ${position(over.id)} de ${ids.length}.` : `${labelOf(String(active.id))} voltou para o lugar.`),
    onDragCancel: ({ active }) => `Movimento cancelado. ${labelOf(String(active.id))} voltou para o lugar.`,
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) onMove(from, to);
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'Para reordenar, pressione Espaço, use as setas para cima e para baixo e pressione Espaço de novo para soltar. Esc cancela.' },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface SortableRow {
  setNode: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  /** Vai no botão de arrastar (a "alça"). */
  handleProps: HTMLAttributes<HTMLElement>;
}

export function useSortableRow(id: string, disabled = false): SortableRow {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return {
    setNode: setNodeRef,
    isDragging,
    style: { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: 'relative' },
    handleProps: { ...attributes, ...listeners },
  };
}

/** Move um item de `from` para `to` sem alterar a lista original. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
