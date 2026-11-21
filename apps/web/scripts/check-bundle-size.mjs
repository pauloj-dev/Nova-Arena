#!/usr/bin/env node
/**
 * Gate do JavaScript inicial por rota (plano R2.1, issue #111): **≤ 180 KB gzip** por página do App Router.
 *
 * Lê a saída do `next build` (Turbopack, Next 16) — o `next build` deixou de imprimir o tamanho por rota:
 * - `build-manifest.json` → `rootMainFiles`: o runtime que toda página carrega (React, roteador do Next);
 * - `server/app/**\/page_client-reference-manifest.js` → `entryJSFiles`: os chunks de cada segmento da rota
 *   (layouts, página e as fronteiras `error`/`not-found`), que o HTML da página referencia logo de cara.
 * Soma o gzip (nível 9) da união desses arquivos. Chunks carregados sob demanda (`import()`, `next/dynamic`)
 * não entram: é exatamente o que a divisão de código tira do caminho crítico.
 *
 * Uso (dentro de `apps/web`, depois do build): `node scripts/check-bundle-size.mjs [--limit=180] [--json] [--update-budget]`.
 * Respeita `NEXT_DIST_DIR` (padrão `.next`). Limite padrão também por `BUNDLE_LIMIT_KB`.
 *
 * **Dívida registrada:** `bundle-budget.json` lista as rotas que ainda passam de 180 KB, cada uma com um teto (o
 * tamanho medido, arredondado para cima de 5 em 5 KB). O gate falha se uma rota nova passar de 180 KB ou se uma rota
 * da lista crescer além do teto: a dívida só pode diminuir. `--update-budget` reescreve o arquivo com os tamanhos
 * atuais (quando a rota diminuir, ou quando um aumento for justificado e revisado no PR).
 * Sai com 1 se alguma rota passar do seu limite.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

export const DEFAULT_LIMIT_KB = 180;

/** `/(site)/c/[slug]/page` → `/c/[slug]` (grupos de rota não aparecem no endereço). */
export function routeFromEntry(entry) {
  const path = entry
    .replace(/\/page$/, '')
    .split('/')
    .filter((part) => part && !/^\(.+\)$/.test(part))
    .join('/');
  return `/${path}`;
}

/**
 * Tamanho inicial de cada rota. Puro: recebe os manifests já lidos e uma função de tamanho por arquivo.
 * @param {{ rootMainFiles: string[], pages: { entry: string, entryJSFiles: Record<string, string[]> }[], sizeOf: (file: string) => number }} input
 * @returns {{ route: string, files: number, bytes: number }[]} do maior para o menor
 */
export function computeRouteSizes({ rootMainFiles, pages, sizeOf }) {
  const rows = pages.map(({ entry, entryJSFiles }) => {
    const files = new Set(rootMainFiles);
    for (const chunks of Object.values(entryJSFiles)) for (const chunk of chunks) files.add(chunk);
    let bytes = 0;
    for (const file of files) bytes += sizeOf(file);
    return { route: routeFromEntry(entry), files: files.size, bytes };
  });
  return rows.sort((a, b) => b.bytes - a.bytes || a.route.localeCompare(b.route));
}

/** Limite da rota: o teto registrado na dívida (`bundle-budget.json`) ou o padrão. */
export function limitFor(route, budget, defaultKb) {
  return budget?.routes?.[route] ?? defaultKb;
}

/** Rotas acima do próprio limite. */
export function overLimit(rows, defaultKb, budget = null) {
  return rows.filter((r) => r.bytes > limitFor(r.route, budget, defaultKb) * 1024);
}

/** Nova lista de dívida: só as rotas acima do padrão, com teto = tamanho atual arredondado para cima (5 em 5 KB). */
export function buildBudget(rows, defaultKb) {
  const routes = {};
  for (const r of [...rows].sort((a, b) => a.route.localeCompare(b.route))) {
    const sizeKb = r.bytes / 1024;
    if (sizeKb > defaultKb) routes[r.route] = Math.ceil(sizeKb / 5) * 5;
  }
  return { limitKb: defaultKb, routes };
}

export const kb = (bytes) => (bytes / 1024).toFixed(1);

function findPageManifests(dir) {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...findPageManifests(full));
    else if (item.name === 'page_client-reference-manifest.js') out.push(full);
  }
  return out;
}

/** Executa o manifest (ele só atribui `globalThis.__RSC_MANIFEST[entry]`) num contexto isolado. */
function readPageManifest(file) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 5000 });
  const entries = Object.entries(sandbox.__RSC_MANIFEST ?? {});
  if (entries.length !== 1) throw new Error(`Formato inesperado em ${file}`);
  const [entry, manifest] = entries[0];
  return { entry, entryJSFiles: manifest.entryJSFiles ?? {} };
}

export function measure(distDir) {
  const buildManifestPath = join(distDir, 'build-manifest.json');
  const appDir = join(distDir, 'server', 'app');
  if (!existsSync(buildManifestPath) || !existsSync(appDir)) {
    throw new Error(`Build não encontrado em ${distDir}. Rode \`next build\` antes (com o mesmo NEXT_DIST_DIR).`);
  }
  const { rootMainFiles = [] } = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
  const pages = findPageManifests(appDir)
    .map(readPageManifest)
    // Páginas internas do Next (404 e erro global) seguem o layout raiz; não são rotas do produto.
    .filter((p) => !p.entry.startsWith('/_'));
  const cache = new Map();
  const sizeOf = (file) => {
    if (!cache.has(file)) {
      const path = join(distDir, file.replace(/^\/?_next\//, ''));
      cache.set(file, existsSync(path) ? gzipSync(readFileSync(path), { level: 9 }).length : 0);
    }
    return cache.get(file);
  };
  return computeRouteSizes({ rootMainFiles, pages, sizeOf });
}

function main() {
  const args = process.argv.slice(2);
  const webDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const budgetPath = join(webDir, 'bundle-budget.json');
  const budget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : null;
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const defaultKb = Number(limitArg?.split('=')[1] ?? process.env.BUNDLE_LIMIT_KB ?? budget?.limitKb ?? DEFAULT_LIMIT_KB);
  const distDir = resolve(webDir, process.env.NEXT_DIST_DIR ?? '.next');
  const rows = measure(distDir);

  if (args.includes('--update-budget')) {
    const next = buildBudget(rows, defaultKb);
    const comment = 'Dívida de JS inicial (issue #111): rotas acima do limite e o teto de cada uma (KB gzip). Gerado por `pnpm --filter web check:bundle --update-budget`; a lista só deve encolher.';
    writeFileSync(budgetPath, `${JSON.stringify({ $comment: comment, ...next }, null, 2)}\n`);
    console.log(`bundle-budget.json atualizado: ${Object.keys(next.routes).length} rota(s) acima de ${defaultKb} KB.`);
    return;
  }

  const failing = overLimit(rows, defaultKb, budget);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ limitKb: defaultKb, routes: rows.map((r) => ({ ...r, kb: Number(kb(r.bytes)), limitKb: limitFor(r.route, budget, defaultKb) })) }, null, 2));
  } else {
    const width = Math.max(...rows.map((r) => r.route.length), 5);
    console.log(`JS inicial por rota (gzip) — ${relative(process.cwd(), distDir).split(sep).join('/') || '.'} — limite ${defaultKb} KB\n`);
    console.log(`${'Rota'.padEnd(width)}  ${'KB'.padStart(7)}  ${'Limite'.padStart(6)}  Situação`);
    for (const r of rows) {
      const limit = limitFor(r.route, budget, defaultKb);
      const status = r.bytes > limit * 1024 ? '✗ acima do limite' : limit > defaultKb ? '! dívida registrada' : 'ok';
      console.log(`${r.route.padEnd(width)}  ${kb(r.bytes).padStart(7)}  ${String(limit).padStart(6)}  ${status}`);
    }
    const debt = rows.filter((r) => r.bytes > defaultKb * 1024).length;
    console.log(`\n${rows.length} rotas · ${rows.length - debt} dentro de ${defaultKb} KB · ${debt} com dívida · maior: ${rows[0] ? `${rows[0].route} (${kb(rows[0].bytes)} KB)` : '—'}`);
  }
  if (failing.length > 0) {
    console.error(`\n${failing.length} rota(s) acima do limite: ${failing.map((r) => `${r.route} (${kb(r.bytes)} KB > ${limitFor(r.route, budget, defaultKb)} KB)`).join(', ')}`);
    console.error('Divida a rota (next/dynamic, import()) ou, se o aumento for justificado, rode `pnpm --filter web check:bundle --update-budget` e explique no PR.');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
