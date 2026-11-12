/** Copiar e compartilhar o convite (Web Share API quando o aparelho tem). */
import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/** Verdadeiro só no navegador que tem `navigator.share` (quase todo celular). No servidor é sempre falso. */
export function useCanShare(): boolean {
  return useSyncExternalStore(
    noop,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  );
}

/** Copia para a área de transferência. Devolve falso se o navegador bloqueou. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Abre a folha de compartilhamento do sistema. Devolve falso se a pessoa fechou sem compartilhar ou deu erro. */
export async function shareInvite(data: { title: string; text: string; url: string }): Promise<boolean> {
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}

/** Endereço completo do convite, para colar no WhatsApp ou no Discord. */
export function absoluteUrl(path: string): string {
  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
}
