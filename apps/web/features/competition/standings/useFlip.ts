'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

const DURATION = 320;

/**
 * Animação FLIP na troca de posição: cada linha `[data-flip-key]` que mudou de lugar desliza da
 * posição antiga para a nova. Respeita "reduzir movimento" (aí só troca de lugar, sem animar).
 * `version` muda quando a ordem pode ter mudado (ex.: `updatedAt` da classificação).
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>, version: unknown): void {
  const previous = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rows = [...container.querySelectorAll<HTMLElement>('[data-flip-key]')];
    const next = new Map<string, number>();
    // `offsetTop` (relativo à tabela) não muda com a rolagem da página entre uma atualização e outra.
    for (const row of rows) next.set(row.dataset.flipKey as string, row.offsetTop);

    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && previous.current.size > 0) {
      for (const row of rows) {
        const before = previous.current.get(row.dataset.flipKey as string);
        const after = next.get(row.dataset.flipKey as string);
        if (before === undefined || after === undefined) continue;
        const delta = before - after;
        if (Math.abs(delta) < 1) continue;
        // Inverte (volta para onde estava) e, no próximo quadro, anima até o lugar novo.
        row.style.transition = 'none';
        row.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          row.style.transition = `transform ${DURATION}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
          row.style.transform = '';
        });
      }
    }
    previous.current = next;
  }, [containerRef, version]);
}
