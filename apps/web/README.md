# apps/web — convenções

App Next.js (App Router) da Nova Arena. Leia junto com o `CLAUDE.md` da raiz.

## Pastas

```
app/
  (site)/        público + participante (casca SiteShell, acento verde). Rotas: /, /campeonatos, /c/[slug], /jogos, /ranking, /u/[nick], /minha-conta/*
  (auth)/        /entrar, /cadastro, /verificar-email, /recuperar-senha, /redefinir-senha, /convite/[token]
  organizador/   área do organizador (AreaShell teal, RequireRole)
  admin/         área do admin (AreaShell verde-escuro, RequireRole + 2FA)
features/<area>/ componentes e lógica de cada funcionalidade (auth, tournaments, teams, registrations, organizer, admin, scoring…)
shared/
  api/client.ts  cliente único (`api.get/post/put/patch/delete`, `ApiError`, `errorMessage`)
  api/keys.ts    todas as query keys do TanStack Query
  api/hooks/     um arquivo por módulo, com `useQuery`/`useMutation`
  session/       `useSession`, `useLogin`, `useLogout`, `useDevLogin`
  layout/        SiteShell, AreaShell, PageContainer, PageHeader, RequireRole, Forbidden
  lib/           datetime (UTC → fuso do usuário), sanitize (rich-text e embeds)
  theme/         tema claro/escuro
mocks/           API simulada (MSW): db.ts, seed.ts, views.ts, http.ts, handlers/<módulo>.ts
e2e/             Playwright (fixtures.ts tem `test`, `expect`, `loginAs`, `waitForApp`)
```

## Regras

1. **Páginas são Client Components finos.** `app/**/page.tsx` só importa o componente da feature e repassa parâmetros. No Next.js 16, `params` e `searchParams` são `Promise`: em Client Component use `use(params)` ou `useParams()`; `useSearchParams()` precisa estar dentro de `<Suspense>`.
2. **Dados só por `shared/api`.** Nada de `fetch` em componente. Cada chamada valida a resposta com o schema de `@nova/schemas` (`api.get(path, { schema })`). Query keys vêm de `keys`. Depois de uma mutação, invalide as chaves afetadas.
3. **Contratos em `@nova/schemas`.** Se faltar um schema, crie no módulo certo do pacote e exporte. Formulários usam React Hook Form + `zodResolver` com o mesmo schema da API.
4. **API simulada.** Um arquivo por módulo em `mocks/handlers/`. Use os helpers de `mocks/http.ts` (`handle`, `body`, `json`, `requireUser`, `requireRole`, `requireTournamentAccess`, `HttpProblem`…) e converta os registros com `mocks/views.ts`. O handler aplica as **mesmas regras e permissões** que a API real terá (PRD §6 e `docs/regras-de-negocio.md`) e chama `save()` depois de mutar `db()`. Rotas específicas antes das genéricas.
5. **UI só com `@nova/ui` e classes ligadas aos tokens** (`bg-surface`, `text-muted`, `bg-accent`, `border-border`, `text-primary-text`, `bg-primary-soft`…). Nenhuma cor hex, `rgb()` ou classe de paleta do Tailwind (`bg-green-500` não existe aqui). `pnpm check:colors` (na raiz) confere.
6. **Mobile primeiro.** Toda tela funciona em 360 px e 1440 px, sem rolagem horizontal. Breakpoints: base (360) · `xs:` 480 · `md:` 768 · `lg:` 1024 · `xl:` 1440.
7. **Três estados em toda consulta:** carregando (`Skeleton` no formato do conteúdo, nunca spinner de tela cheia), vazio (`EmptyState` com ação sugerida) e erro (`ErrorState` com "Tentar novamente").
8. **Acessibilidade AA.** Um `<h1>` por página, rótulo em todo campo, botões com nome acessível, status com ícone + texto (`StatusPill`), foco visível, tudo operável por teclado.
9. **Datas:** ISO em UTC nos dados; na tela, sempre `formatDateTime`/`formatDate`/`formatTime` de `shared/lib/datetime` (mostram o fuso). Campos de data usam `localInputToIso`/`isoToLocalInput`.
10. **Textos em pt-BR**, na voz do produto: diretos, falando com o jogador ou o organizador. Erros dizem o que aconteceu e o que fazer.
11. **Feedback de mutação:** `useToast()` para sucesso e erro (`errorMessage(e)`); erros de campo (`ApiError.fieldErrors`) vão para o formulário.

## Componentes do design system (`@nova/ui`)

`Button` (variant: primary/secondary/ghost/danger/gold · size · loading · asChild · iconLeft/iconRight · fullWidth), `Input`, `Textarea`, `Select` (nativo, `options`), `Checkbox`, `Switch`, `Badge`, `StatusPill` (`status`), `Card`, `Avatar`, `Tabs` (`items`), `Skeleton`, `EmptyState`, `ErrorState`, `Progress`, `Modal`, `ConfirmDestructive`, `Drawer`, `useToast`, `Stepper`, `DataTable`, `cn`. Ícones: `lucide-react`. Primitivos extras: `radix-ui`. Veja o Storybook (`pnpm storybook`) ou `packages/ui/src/components`.

## Protótipo

- Seletor **"Entrar como"** (canto inferior esquerdo): Bianca (participante), Lucas (capitão), Camila (organizadora verificada), Diego (organizador), Ana (admin), Rafael (super admin). Senha de todas as contas: `arena1234`.
- Os dados ficam no `localStorage` do navegador. "Reiniciar dados" volta ao seed (`mocks/seed.ts`).
- `NEXT_PUBLIC_API_MOCK`: `all` (padrão) · `none` · lista de módulos (`auth,games`).

## Testes

```bash
pnpm --filter web test         # Vitest (unitários e de componente; arquivos *.test.ts(x) ao lado do código)
pnpm --filter web e2e          # Playwright em 1440 px e 360 px (constrói e sobe o app em :3100)
```

Para rodar E2E contra um servidor já no ar: `PLAYWRIGHT_BASE_URL=http://localhost:3111 pnpm --filter web exec playwright test`.
Para subir uma segunda instância sem conflito de build: `NEXT_DIST_DIR=.next-x pnpm --filter web exec next dev -p 3111`.

Nos testes E2E, importe `test`, `expect`, `loginAs` e `waitForApp` de `./fixtures`. Cada teste começa com o banco simulado limpo (contexto novo do navegador).
