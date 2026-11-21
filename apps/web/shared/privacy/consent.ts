'use client';

/**
 * Consentimento de medição (issue #115, RNF-10). O site só usa cookies **necessários** (sessão, segurança da conta);
 * a medição de uso (Vercel Analytics e Speed Insights) não usa cookies, mas mesmo assim só liga com o "sim" da
 * pessoa — o padrão é a opção mais restritiva. A escolha fica no próprio navegador (`localStorage`), nunca no servidor.
 */
import { CookieConsent } from '@nova/schemas';
import { useSyncExternalStore } from 'react';

export const CONSENT_KEY = 'nova-consent';
const EVENT = 'nova:consent';
/** Pedido para reabrir o banner (link "Preferências de cookies"). */
const REOPEN_EVENT = 'nova:consent-reopen';

/** Escolha feita com o armazenamento bloqueado: vale só nesta visita. */
let memory: string | null = null;

function rawValue(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function parse(raw: string | null): CookieConsent | null {
  if (!raw) return null;
  try {
    const parsed = CookieConsent.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let cached: { raw: string | null; value: CookieConsent | null } = { raw: null, value: null };
function snapshot(): CookieConsent | null {
  const raw = rawValue();
  if (raw !== cached.raw) cached = { raw, value: parse(raw) };
  return cached.value;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** `undefined` no servidor e antes de hidratar; `null` = ainda não escolheu. */
export function useConsent(): CookieConsent | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

export function saveConsent(analytics: boolean, now = new Date()): CookieConsent {
  const value: CookieConsent = { version: 1, analytics, decidedAt: now.toISOString() };
  memory = JSON.stringify(value);
  try {
    localStorage.setItem(CONSENT_KEY, memory);
  } catch {
    // Armazenamento bloqueado: vale só nesta visita (`memory`).
  }
  window.dispatchEvent(new Event(EVENT));
  return value;
}

export function reopenConsent(): void {
  window.dispatchEvent(new Event(REOPEN_EVENT));
}

export function onReopenConsent(listener: () => void): () => void {
  window.addEventListener(REOPEN_EVENT, listener);
  return () => window.removeEventListener(REOPEN_EVENT, listener);
}
