'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { nextIndex, previousIndex, type TelaoTheme } from './telao';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}

/** A pessoa pediu menos movimento no sistema. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export interface Rotation {
  index: number;
  paused: boolean;
  next: () => void;
  previous: () => void;
  togglePause: () => void;
}

/**
 * Rotação automática entre as páginas do telão. Não gira com uma página só; quando o número de páginas
 * muda (ex.: a rodada avançou), a página atual é mantida se ainda existir.
 */
export function useRotation(count: number, intervalMs: number): Rotation {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = count > 0 ? Math.min(index, count - 1) : 0;

  useEffect(() => {
    if (paused || count <= 1) return;
    const id = window.setInterval(() => setIndex((i) => nextIndex(Math.min(i, count - 1), count)), intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs, paused]);

  return {
    index: current,
    paused,
    next: () => setIndex(nextIndex(current, count)),
    previous: () => setIndex(previousIndex(current, count)),
    togglePause: () => setPaused((p) => !p),
  };
}

/**
 * Fundo transparente (OBS) e tema do telão. Muda o `<html>` e o `<body>` só enquanto o telão está aberto
 * e devolve como estava ao sair (o tema escolhido pela pessoa no site não é alterado).
 */
export function useTelaoEnvironment(transparent: boolean, theme: TelaoTheme): void {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const before = { theme: html.dataset.theme, htmlBg: html.style.backgroundColor, bodyBg: body.style.backgroundColor };
    html.dataset.theme = theme === 'claro' ? 'light' : 'dark';
    html.dataset.telao = transparent ? 'transparente' : 'padrao';
    if (transparent) {
      html.style.backgroundColor = 'transparent';
      body.style.backgroundColor = 'transparent';
    }
    return () => {
      if (before.theme) html.dataset.theme = before.theme;
      else delete html.dataset.theme;
      delete html.dataset.telao;
      html.style.backgroundColor = before.htmlBg;
      body.style.backgroundColor = before.bodyBg;
    };
  }, [transparent, theme]);
}
