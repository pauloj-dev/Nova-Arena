/**
 * Quando o service worker do PWA é registrado (issue #105).
 *
 * - Com qualquer módulo da API simulado (`NEXT_PUBLIC_API_MOCK` diferente de `none`), **não**: o MSW registra o
 *   próprio worker (`/mockServiceWorker.js`) no mesmo escopo `/`, e só pode haver um worker por escopo.
 *   O manifesto, os ícones e o botão "Instalar app" continuam valendo (o navegador aceita a instalação).
 * - Em desenvolvimento, não (o build de desenvolvimento muda a cada salvamento e o cache atrapalharia).
 * - `NEXT_PUBLIC_PWA=off` desliga em qualquer ambiente; `NEXT_PUBLIC_PWA=on` força (só para testar sem mock).
 */
export function isPwaEnabled(env: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_PWA: process.env.NEXT_PUBLIC_PWA, NEXT_PUBLIC_API_MOCK: process.env.NEXT_PUBLIC_API_MOCK }): boolean {
  if (env.NEXT_PUBLIC_PWA === 'off') return false;
  if (env.NEXT_PUBLIC_PWA === 'on') return true;
  return env.NODE_ENV === 'production' && (env.NEXT_PUBLIC_API_MOCK ?? 'all') === 'none';
}
