'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

const DURATION_MS = 450;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animação FLIP para linhas que trocam de posição (PRD §15.8): mede onde cada linha estava,
 * deixa o React reordenar e anima do lugar antigo até o novo. Não anima quando a pessoa pede
 * menos movimento (`prefers-reduced-motion`).
 *
 * `order` é a ordem atual das chaves; devolve a função que registra o elemento de cada chave:
 * `<tr ref={register(row.registrationId)}>`.
 */
export function useFlip<T extends HTMLElement>(order: readonly string[]): (key: string) => (element: T | null) => void {
  const elements = useRef(new Map<string, T>());
  const tops = useRef(new Map<string, number>());
  const lastSignature = useRef<string | null>(null);
  const signature = order.join('|');

  // Mede a cada render (linhas expandidas mudam a altura das de baixo), mas só anima quando a ordem muda.
  useLayoutEffect(() => {
    const previous = tops.current;
    const next = new Map<string, number>();
    const animate = lastSignature.current !== null && lastSignature.current !== signature && !prefersReducedMotion();
    for (const [key, element] of elements.current) {
      const top = element.offsetTop;
      next.set(key, top);
      const before = previous.get(key);
      if (animate && before !== undefined && before !== top && typeof element.animate === 'function') {
        element.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    tops.current = next;
    lastSignature.current = signature;
  });

  return useCallback(
    (key: string) => (element: T | null) => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    },
    [],
  );
}
