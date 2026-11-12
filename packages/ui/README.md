# @nova/ui — design system "Nova Green"

Componentes React 19 sobre Radix UI e Tailwind v4. As cores, a tipografia e os espaçamentos vêm de `src/styles/tokens.css` (PRD §15.2–15.4); `src/styles/theme.css` liga esses tokens às classes do Tailwind.

## Como usar

```css
/* CSS de entrada do app */
@import 'tailwindcss';
@import '@nova/ui/styles/tokens.css';
@import '@nova/ui/styles/theme.css';
@source '../../packages/ui/src'; /* caminho relativo a este arquivo CSS */
```

```tsx
import { Button, StatusPill } from '@nova/ui';
```

- Tema: `data-theme="dark"` no `<html>` liga o "Arena Night".
- Área: `data-area="organizer"` ou `data-area="admin"` troca o acento (`bg-accent`, `text-on-accent`…). Sem o atributo, vale a área do participante.
- Fontes: defina `--font-rajdhani`, `--font-inter` e `--font-jetbrains` (no app, com `next/font`).
- Nenhuma cor fora dos tokens: use `bg-surface`, `text-muted`, `bg-accent`… nunca hex, `rgb()` ou `hsl()`.

## Comandos

Rode a partir da raiz do repositório.

| Comando | O que faz |
|---|---|
| `pnpm --filter @nova/ui storybook` | Storybook em `http://localhost:6006`, com troca de tema e de área na barra |
| `pnpm --filter @nova/ui build-storybook` | Gera o Storybook estático em `storybook-static` |
| `pnpm --filter @nova/ui test` | Testes de componente (Vitest + Testing Library + axe), contraste AA dos tokens e regra de cores |
| `pnpm --filter @nova/ui lint` | ESLint + verificação "nenhuma cor fora dos tokens" |
| `pnpm --filter @nova/ui typecheck` | TypeScript |
| `pnpm --filter @nova/ui check:colors` | Só a verificação de cores |
| `pnpm --filter @nova/ui test:visual` | Screenshots nos dois temas + axe em todas as stories, num navegador de verdade |

### O que os testes cobrem

- `src/components/*.test.tsx`: estados, foco e teclado de cada componente, e axe-core sem nenhuma violação.
- `src/styles/contrast.test.ts`: lê `tokens.css`, resolve as variáveis para tema claro e escuro nas três áreas e confere cada par texto/fundo usado pelos componentes (≥ 4,5:1 para texto, ≥ 3:1 para bordas de controle e indicadores). Se criar um par novo num componente, acrescente-o à lista do teste.
- `src/styles/colors.test.ts`: falha se algum `.ts`, `.tsx` ou `.css` de `src` (fora `tokens.css`) tiver cor literal.

### Verificação de cores em outro pacote

O verificador é reutilizável e recebe os diretórios por argumento:

```bash
node packages/ui/scripts/check-colors.mjs apps/web/app apps/web/shared
node packages/ui/scripts/check-colors.mjs src --allow src/legado.css --ext .ts,.tsx,.css,.mdx
```

Também dá para importar: `import { findColors } from '@nova/ui/check-colors'`. Para liberar uma linha de propósito, escreva `check-colors-ignore` num comentário na mesma linha ou na linha de cima.

### Regressão visual

```bash
pnpm --filter @nova/ui build-storybook
pnpm --filter @nova/ui exec playwright install chromium   # só na primeira vez
pnpm --filter @nova/ui test:visual                        # compara com visual/__screenshots__
pnpm --filter @nova/ui test:visual:update                 # regrava as imagens depois de uma mudança intencional
```

Sem o Chromium do Playwright, use o Chrome instalado: `PW_CHANNEL=chrome pnpm --filter @nova/ui test:visual`.

O teste abre o Storybook estático, tira screenshot das stories principais nos temas claro e escuro e roda o axe (incluindo contraste de cor real) em todas as stories, nos dois temas e nas três áreas. As imagens de referência dependem do sistema operacional e do navegador: as que estão em `visual/__screenshots__` foram geradas no macOS com o Google Chrome. Em outro ambiente, regrave antes de comparar. Este teste não entra no `pnpm test`.

## Componentes

Todos aceitam `className`, salvo indicação. Os campos e os botões têm área de toque de 44 px no celular.

| Componente | Props principais | Observações |
|---|---|---|
| `Button` | `variant` (`primary` \| `secondary` \| `ghost` \| `danger` \| `gold`), `size` (`sm` \| `md` \| `lg`), `loading`, `disabled`, `iconLeft`, `iconRight`, `fullWidth`, `asChild` | `loading` desabilita e marca `aria-busy`. `asChild` aplica o visual ao filho (ex.: `<Link>`) |
| `Input` | `label`, `hint`, `error`, `required`, `hideLabel`, `inputClassName` + atributos de `<input>` | `error` vira `role="alert"` e marca `aria-invalid` |
| `Textarea` | `label`, `hint`, `error`, `required`, `hideLabel`, `rows` (4) + atributos de `<textarea>` | — |
| `Select` | `label`, `options` (`{ value, label, disabled? }[]`), `placeholder`, `hint`, `error`, `required`, `hideLabel` | `<select>` nativo: usa o seletor do sistema no celular |
| `Checkbox` | `label`, `hint`, `checked`, `onCheckedChange`, `disabled`, `id` | Controlado. Espaço marca |
| `Switch` | `label`, `hint`, `checked`, `onCheckedChange`, `disabled`, `id` | Controlado. Espaço e Enter alternam |
| `Badge` | `tone` (`neutral` \| `primary` \| `accent` \| `info` \| `warning` \| `danger` \| `gold`), `icon` | — |
| `StatusPill` | `status` (todos os status do produto: `DRAFT`, `REGISTRATION_OPEN`, `LIVE`, `WALKOVER`…), `label` | Sempre ícone + texto. `statusLabel(status)` devolve só o texto |
| `Card` | `padding` (`none` \| `sm` \| `md`), `interactive` | — |
| `Avatar` | `name`, `src`, `size` (`sm` \| `md` \| `lg` \| `xl`) | Decorativo: mostre o nome em texto ao lado |
| `Tabs` | `items` (`{ value, label, content, disabled? }[]`), `label`, `value`, `defaultValue`, `onValueChange` | Setas, Home e End trocam de aba |
| `Skeleton` | `className` (formato do conteúdo) | `aria-hidden`; marque o contêiner com `aria-busy` |
| `EmptyState` | `title`, `description`, `icon`, `action` | — |
| `ErrorState` | `title`, `description`, `onRetry`, `children` | `role="alert"`; `onRetry` mostra "Tentar novamente" |
| `Progress` | `value`, `max`, `label` | Mostra `value/max` em texto além da barra |
| `Modal` | `open`, `onOpenChange`, `title`, `description`, `footer`, `size` (`sm` \| `md` \| `lg`) | Tela cheia no celular. Foco preso, Esc fecha, foco volta a quem abriu |
| `ConfirmDestructive` | `open`, `onOpenChange`, `title`, `description`, `confirmText`, `confirmLabel`, `onConfirm`, `loading` | O botão só libera digitando `confirmText` |
| `Drawer` | `open`, `onOpenChange`, `title`, `side` (`left` \| `right` \| `bottom`), `footer` | Mesmo comportamento de foco do `Modal` |
| `ToastProvider` / `useToast` | `toast({ title, description, tone, duration })`, `success(title, description?)`, `error(title, description?)` | Região `aria-live="polite"`. Some em 5 s (erro: 8 s); `duration: 0` fica até fechar |
| `Stepper` | `steps` (`{ id, label, description? }[]`), `current`, `reached`, `onStepClick`, `orientation` (`horizontal` \| `vertical`) | No celular vira "Passo 3 de 7" + barra. Só os passos até `reached` são clicáveis |
| `DataTable` | `caption`, `columns`, `rows`, `getRowId`, `loading`, `empty`, `sort` + `onSortChange`, `page` + `pageCount` + `onPageChange` + `total`, `selected` + `onSelectedChange`, `bulkActions`, `rowActions` | Ordenação e paginação são controladas (servidor). No celular vira lista de cartões |

Coluna da `DataTable`: `{ id, header, cell, sortable?, align?, primary?, hideOnMobile?, className? }`.
