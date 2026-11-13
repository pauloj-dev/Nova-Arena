'use client';

import { useEffect, useRef, useState } from 'react';

// Cores dos tokens (ouro, verde da marca, teal): o confete usa as mesmas classes do resto do produto.
const TONES = ['bg-gold', 'bg-primary-500', 'bg-accent', 'bg-silver', 'bg-bronze'];
const PIECES = 36;

/** Número pseudoaleatório estável por peça (mesma chuva a cada render, sem `Math.random` no render). */
function seeded(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Confete discreto do encerramento: algumas dezenas de peças que caem uma vez, por ~2,5 s, e somem.
 * Sem dependência (Web Animations API) e sem nada para quem pede menos movimento
 * (`prefers-reduced-motion`). É decorativo: fica fora da árvore de acessibilidade e não captura cliques.
 */
export function Confetti({ durationMs = 2600 }: { durationMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (prefersReducedMotion() || typeof root.animate !== 'function') {
      const id = requestAnimationFrame(() => setDone(true));
      return () => cancelAnimationFrame(id);
    }
    const animations = [...root.children].map((piece, i) =>
      (piece as HTMLElement).animate(
        [
          { transform: 'translate3d(0, -10vh, 0) rotate(0deg)', opacity: 1 },
          { transform: `translate3d(${Math.round((seeded(i, 3) - 0.5) * 160)}px, 105vh, 0) rotate(${Math.round(360 + seeded(i, 4) * 540)}deg)`, opacity: 0.9 },
        ],
        { duration: durationMs * (0.7 + seeded(i, 5) * 0.3), delay: seeded(i, 6) * 500, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' },
      ),
    );
    const timer = setTimeout(() => setDone(true), durationMs + 600);
    return () => {
      clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
  }, [durationMs]);

  if (done) return null;
  return (
    <div ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden" data-testid="confetti">
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          className={`absolute top-0 block rounded-sm opacity-0 ${TONES[i % TONES.length]}`}
          style={{ left: `${Math.round(seeded(i, 1) * 100)}%`, width: 6 + Math.round(seeded(i, 2) * 4), height: 10 + Math.round(seeded(i, 7) * 6) }}
        />
      ))}
    </div>
  );
}
