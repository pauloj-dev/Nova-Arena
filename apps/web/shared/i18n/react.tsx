'use client';

/**
 * Lado React da i18n (issue 108, ADR-0004): o idioma vem do contexto (`LocaleProvider`, no layout raiz); sem
 * provider vale o padrão (pt-BR), então componente e teste funcionam sem montar nada a mais.
 *
 *   const t = useT(messages, 'Pagina');
 *   return <h1>{t('titulo')}</h1>;
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale } from './config';
import { getFormat, getT, type Catalog, type Messages, type NamespaceOf } from './core';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Tradutor de um catálogo no idioma da página. */
export function useT<M extends Messages, const N extends NamespaceOf<M> = never>(catalog: Catalog<M>, namespace?: N) {
  const locale = useLocale();
  return useMemo(() => getT<M, N>(catalog, namespace, locale), [catalog, namespace, locale]);
}

/** Números, listas e tempo relativo no idioma da página. */
export function useFormat() {
  const locale = useLocale();
  return useMemo(() => getFormat(locale), [locale]);
}
