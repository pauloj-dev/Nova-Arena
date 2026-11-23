/**
 * Confere uma ou mais áreas contra a regra de texto fixo (issue 108), mesmo que ainda estejam em `i18n-pendentes.mjs`.
 *
 *   pnpm --filter web check:i18n features/teams features/calendar
 *   pnpm --filter web check:i18n            # tudo (o que falta migrar)
 */
import { ESLint } from 'eslint';
import { I18N_RULE } from '../i18n-lint.mjs';

const targets = process.argv.slice(2);
const patterns = (targets.length ? targets : ['app', 'features', 'shared']).map((t) => (t.endsWith('.tsx') ? t : `${t.replace(/\/$/, '')}/**/*.tsx`));
const eslint = new ESLint({
  overrideConfig: [{ files: ['**/*.tsx'], rules: { 'i18next/no-literal-string': I18N_RULE } }],
  ignorePatterns: ['**/*.test.tsx', '**/*.stories.tsx'],
});
const results = await eslint.lintFiles(patterns);
const only = results
  .map((r) => ({ ...r, messages: r.messages.filter((m) => m.ruleId === 'i18next/no-literal-string') }))
  .filter((r) => r.messages.length);
const total = only.reduce((n, r) => n + r.messages.length, 0);
if (total) {
  const formatter = await eslint.loadFormatter('stylish');
  console.log(await formatter.format(only));
  console.error(`check-i18n: ${total} texto(s) fixo(s) em ${only.length} arquivo(s).`);
  // `exitCode`, não `exit()`: a saída longa precisa terminar de ser escrita.
  process.exitCode = 1;
} else {
  console.log(`check-i18n: nenhum texto fixo em ${targets.length ? targets.join(', ') : 'app, features e shared'}.`);
}
