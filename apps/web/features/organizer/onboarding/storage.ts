/**
 * Preferências do onboarding do organizador (issue #62), guardadas só neste aparelho:
 * checklist dispensado, dicas já vistas e passos feitos que a API não registra.
 */
import { useCallback, useSyncExternalStore } from 'react';

const PREFIX = 'nova:onboarding:';
const EVENT = 'nova:onboarding';

export type OnboardingFlag = 'checklist-dispensado' | 'modelos-vistos' | `dica:${string}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readFlag(flag: OnboardingFlag, userId: string | null | undefined): boolean {
  try {
    return storage()?.getItem(`${PREFIX}${userId ?? 'anon'}:${flag}`) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(flag: OnboardingFlag, userId: string | null | undefined, value = true): void {
  try {
    const key = `${PREFIX}${userId ?? 'anon'}:${flag}`;
    if (value) storage()?.setItem(key, '1');
    else storage()?.removeItem(key);
  } catch {
    // Sem armazenamento local: a preferência vale só até recarregar.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Lê uma preferência e devolve como marcá-la. No servidor (e antes de hidratar) vale `serverValue`. */
export function useOnboardingFlag(flag: OnboardingFlag, userId: string | null | undefined, serverValue = true): [boolean, (value?: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readFlag(flag, userId),
    () => serverValue,
  );
  const set = useCallback((next = true) => writeFlag(flag, userId, next), [flag, userId]);
  return [value, set];
}
