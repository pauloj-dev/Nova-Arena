# ADR-0004 — Textos externalizados: catálogo por área sobre o núcleo do next-intl

- **Status:** aceita
- **Data:** 2026-11-21
- **Issue:** #108 (R1.6; PRD RNF-16)

## Contexto

O produto é só em pt-BR, mas o PRD pede que en e es possam entrar sem retrabalho (RNF-16). A #108 pede todos os textos
de interface, e-mails e notificações em arquivos de mensagens, datas, números e plurais pelo idioma, e uma verificação
no CI contra texto fixo em componente.

Restrições que pesam:

- **JS inicial por rota (#111):** um único arquivo de mensagens com todo o produto iria para todas as páginas.
- **Mais de mil testes de componente** que montam a tela sem provider nenhum, e o site não tem idioma na URL.
- **Componentes de servidor e de cliente** misturados (o layout raiz, os `loading.tsx` e as páginas públicas renderizam
  no servidor).

## Decisão

1. **Formatador do next-intl, sem o roteamento.** `createTranslator` e `createFormatter` (ICU: plural, `select`,
   números e `t.rich` para trechos com marcação). Não usamos o provider global nem o roteamento por idioma do
   next-intl enquanto houver um idioma só.
2. **Catálogo por área.** `features/<área>/messages/pt-BR.json` com `index.ts` (`defineMessages({ 'pt-BR': ptBR })`).
   Os textos comuns e os de `shared/` ficam em `shared/i18n/messages`. A página só carrega o texto das áreas que usa,
   e o tipo das chaves sai do próprio JSON: chave errada não compila.
3. **Duas portas de entrada.**
   - `getT(catálogo, 'Trecho')` (`shared/i18n/core`): sem React. Para servidor, `metadata`, funções puras e testes.
   - `useT(catálogo, 'Trecho')` (`shared/i18n/react`): componentes cliente. O idioma vem do `LocaleProvider`; sem
     provider vale pt-BR, então nenhum teste precisa montar nada a mais.
4. **Chave ausente quebra** fora de produção (erro no teste); em produção aparece a chave e o erro vai ao console.
5. **Datas** continuam em `shared/lib/datetime` (que cuida do fuso), usando o mesmo idioma (`DEFAULT_LOCALE`).
6. **Verificação no CI:** a regra `i18next/no-literal-string` no ESLint (`apps/web/i18n-lint.mjs`). Ela acusa texto
   entre tags e os atributos que a pessoa lê ou ouve (`aria-label`, `placeholder`, `title`, `alt`, `label`…). Áreas
   ainda não migradas ficam em `apps/web/i18n-pendentes.mjs`; a lista vazia é o critério de aceite.
   `pnpm --filter web check:i18n <pastas>` confere uma área.

## Consequências

- Para um idioma novo: o código entra em `LOCALES`, um `en.json` ao lado de cada `pt-BR.json` e a escolha do idioma
  (cookie ou URL) alimenta o `LocaleProvider` e o `getT(…, locale)` do servidor. Faltando um texto, vale o pt-BR.
- O formatador ICU custa alguns KB de JS em toda rota que tem texto.
- A regra não enxerga texto fora de JSX: toasts, mapas de rótulos em `.ts` e mensagens de validação dependem da revisão
  de quem migra a área.
- As mensagens de validação dos contratos (`packages/schemas`) e o `detail` dos erros da API continuam em pt-BR no
  servidor. Elas já vêm com um `code`; a tradução no cliente pelo `code` fica para quando entrar o segundo idioma.
