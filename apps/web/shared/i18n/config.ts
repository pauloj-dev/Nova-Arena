/**
 * Idiomas do produto (issue 108, ADR-0004). Hoje só pt-BR; en e es entram acrescentando o código aqui e um
 * `en.json`/`es.json` ao lado de cada `pt-BR.json` (o catálogo de cada área diz quais idiomas tem).
 */
export const LOCALES = ['pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
