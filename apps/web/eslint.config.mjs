import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { I18N_PENDENTES } from "./i18n-pendentes.mjs";
import { i18nConfig } from "./i18n-lint.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Nenhum texto de interface fixo (issue 108): vale em tudo, menos nas áreas ainda pendentes.
  i18nConfig,
  ...(I18N_PENDENTES.length ? [{ files: I18N_PENDENTES, rules: { "i18next/no-literal-string": "off" } }] : []),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/mockServiceWorker.js",
    ".next-*/**",
    "test-results-*/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
