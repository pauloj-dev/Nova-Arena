/**
 * Textos de interface em arquivos de mensagens (issue 108, ADR-0004), com o formatador do `next-intl`
 * (`createTranslator`: ICU com plural, `select`, números e `t.rich` para trechos com marcação).
 *
 * Cada área tem o próprio catálogo (`features/<área>/messages/pt-BR.json` + `index.ts`), para a página só baixar
 * o texto das áreas que usa. Este módulo não depende de React: serve a componentes de servidor, `metadata`,
 * funções puras e testes. Em componente cliente, use `useT` de `./react`.
 *
 *   import { messages } from '../messages';
 *   const t = getT(messages, 'Pagina');
 *   t('titulo'); t('inscritos', { count: 3 }); // "{count, plural, one {# inscrito} other {# inscritos}}"
 */
import { createFormatter, createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import { DEFAULT_LOCALE, type Locale } from './config';

/** Árvore de mensagens de um catálogo (o JSON de um idioma). */
export type Messages = { [key: string]: string | Messages };

/** Catálogo de uma área: o pt-BR é obrigatório e é o texto de reserva dos outros idiomas. */
export type Catalog<M extends Messages = Messages> = { readonly 'pt-BR': M } & { readonly [L in Exclude<Locale, 'pt-BR'>]?: M };

/** Declara o catálogo de uma área (só tipa: o objeto é o mesmo). */
export function defineMessages<M extends Messages>(catalog: Catalog<M>): Catalog<M> {
  return catalog;
}

function messagesFor<M extends Messages>(catalog: Catalog<M>, locale: Locale): M {
  return (catalog as Partial<Record<Locale, M>>)[locale] ?? catalog['pt-BR'];
}

/**
 * Chave ausente não pode passar despercebida: no desenvolvimento e nos testes vira erro; em produção a tela mostra
 * a própria chave (feio, mas não derruba a página) e o erro vai para o console (e daí para o Sentry).
 */
function onError(error: Error): void {
  if (process.env.NODE_ENV !== 'production') throw error;
  console.error(error);
}

/** Trechos de um catálogo que podem ser o `namespace` do tradutor (ex.: `'Pagina'`, `'Pagina.vazio'`). */
export type NamespaceOf<M extends Messages> = NamespaceKeys<M, NestedKeyOf<M>>;

/** Tradutor de um catálogo (opcionalmente só de um trecho dele, o `namespace`). Chave errada não compila. */
export function getT<M extends Messages, const N extends NamespaceOf<M> = never>(catalog: Catalog<M>, namespace?: N, locale: Locale = DEFAULT_LOCALE) {
  return createTranslator<M, N>({ locale, messages: messagesFor(catalog, locale), namespace, onError });
}

/** Formatação de números, listas e tempo relativo no idioma (datas: `shared/lib/datetime`, que cuida do fuso). */
export function getFormat(locale: Locale = DEFAULT_LOCALE) {
  return createFormatter({ locale, onError });
}
