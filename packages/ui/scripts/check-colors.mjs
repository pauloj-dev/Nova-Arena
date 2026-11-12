#!/usr/bin/env node
/**
 * Regra "nenhuma cor fora dos tokens" (CLAUDE.md, regra 4).
 *
 * Procura cor literal (hex, rgb(), hsl(), oklch()…) em arquivos .ts, .tsx e .css.
 * Só `tokens.css` pode ter cor: o resto usa as classes ligadas aos tokens (`bg-surface`, `text-muted`…).
 *
 * Uso:
 *   node check-colors.mjs <dir> [<dir>…] [--allow <arquivo>]… [--ext .ts,.tsx,.css]
 *
 * Para liberar uma linha de propósito (ex.: um teste do próprio leitor de cores), escreva
 * `check-colors-ignore` em um comentário na mesma linha ou na linha de cima.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.css'];
export const DEFAULT_ALLOWED_FILES = ['tokens.css'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'storybook-static', '.next', '.turbo', '.git']);
const IGNORE_MARK = 'check-colors-ignore';

// #rgb, #rgba, #rrggbb ou #rrggbbaa. Não casa com entidades HTML (&#123;) nem com âncoras maiores (#secao).
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;

/**
 * @param {string} source conteúdo do arquivo
 * @returns {Array<{ line: number, column: number, match: string, text: string }>}
 */
export function findColorsInSource(source) {
  const found = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((text, index) => {
    if (text.includes(IGNORE_MARK) || lines[index - 1]?.includes(IGNORE_MARK)) return;
    for (const pattern of [HEX, COLOR_FUNCTION]) {
      for (const m of text.matchAll(pattern)) {
        found.push({ line: index + 1, column: m.index + 1, match: m[0], text: text.trim() });
      }
    }
  });
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * @param {string[]} dirs diretórios (ou arquivos) a verificar
 * @param {{ extensions?: string[], allow?: string[], cwd?: string }} [options]
 *   `allow`: nomes de arquivo (ex.: `tokens.css`) ou caminhos relativos a `cwd` que podem conter cor.
 * @returns {Array<{ file: string, line: number, column: number, match: string, text: string }>}
 */
export function findColors(dirs, options = {}) {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const allow = options.allow ?? DEFAULT_ALLOWED_FILES;
  const cwd = options.cwd ?? process.cwd();
  const allowedPaths = new Set(allow.map((a) => resolve(cwd, a)));
  const violations = [];
  for (const dir of dirs) {
    const root = resolve(cwd, dir);
    const files = statSync(root).isDirectory() ? walk(root) : [root];
    for (const file of files) {
      if (!extensions.some((ext) => file.endsWith(ext))) continue;
      if (allow.includes(basename(file)) || allowedPaths.has(file)) continue;
      for (const hit of findColorsInSource(readFileSync(file, 'utf8'))) {
        violations.push({ file: relative(cwd, file), ...hit });
      }
    }
  }
  return violations;
}

function parseArgs(argv) {
  const dirs = [];
  const allow = [...DEFAULT_ALLOWED_FILES];
  let extensions = DEFAULT_EXTENSIONS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allow') allow.push(argv[++i] ?? '');
    else if (arg === '--ext') extensions = (argv[++i] ?? '').split(',').map((e) => (e.startsWith('.') ? e : `.${e}`));
    else dirs.push(arg);
  }
  return { dirs, allow: allow.filter(Boolean), extensions };
}

function main() {
  const { dirs, allow, extensions } = parseArgs(process.argv.slice(2));
  if (dirs.length === 0) {
    console.error('Uso: check-colors.mjs <dir> [<dir>…] [--allow <arquivo>]… [--ext .ts,.tsx,.css]');
    process.exit(2);
  }
  const violations = findColors(dirs, { allow, extensions });
  if (violations.length === 0) {
    console.log(`check-colors: nenhuma cor fora dos tokens em ${dirs.join(', ')}.`);
    return;
  }
  for (const v of violations) console.error(`${v.file}:${v.line}:${v.column}  ${v.match}  →  ${v.text}`);
  console.error(`\ncheck-colors: ${violations.length} cor(es) fora dos tokens. Use as classes ligadas aos tokens (bg-surface, text-muted, bg-accent…).`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
