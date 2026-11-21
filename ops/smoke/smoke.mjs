#!/usr/bin/env node
/**
 * Smoke test pós-deploy (issue #117, plano R2 "Regressão"): confere em segundos se um deploy está de pé.
 *
 *   node ops/smoke/smoke.mjs https://staging.novaarena.gg
 *   SMOKE_BASE_URL=https://<preview>.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=... pnpm smoke
 *
 * Sem dependências (Node 22: `fetch` nativo). Só leitura: não cria conta, não faz login, não grava nada.
 * Sai com código 0 quando tudo passou, 1 quando algo falhou e 2 quando faltou a URL.
 *
 * Variáveis:
 * - `SMOKE_BASE_URL` (ou o 1º argumento): URL do deploy, sem barra no fim.
 * - `VERCEL_AUTOMATION_BYPASS_SECRET`: passa pela proteção de deploy dos previews (`x-vercel-protection-bypass`).
 * - `SMOKE_TIMEOUT_MS` (padrão 15000): tempo máximo de cada requisição.
 * - `SMOKE_LENTO_MS` (padrão 3000): acima disso a verificação passa, mas com aviso de lentidão.
 * - `SMOKE_SEM_HEADERS=1`: não confere os headers de segurança (ex.: `next dev` local, que não é o alvo deste teste).
 */

const base = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+/.test(base)) {
  console.error('Uso: node ops/smoke/smoke.mjs <url do deploy>  (ou defina SMOKE_BASE_URL)');
  console.error('Ex.: node ops/smoke/smoke.mjs https://staging.novaarena.gg');
  process.exit(2);
}

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const LENTO_MS = Number(process.env.SMOKE_LENTO_MS || 3000);
const CONFERIR_HEADERS = process.env.SMOKE_SEM_HEADERS !== '1';
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const https = base.startsWith('https://');

const resultados = [];

async function pedir(caminho, accept) {
  const headers = { 'User-Agent': 'nova-arena-smoke/1.0', Accept: accept };
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  const inicio = performance.now();
  const res = await fetch(`${base}${caminho}`, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const corpo = await res.text();
  return { res, corpo, ms: Math.round(performance.now() - inicio) };
}

/** Roda uma verificação: `fn` devolve o resultado da requisição e lança `Error` com a explicação se falhar. */
async function verificar(nome, fn) {
  try {
    const { ms, nota } = await fn();
    const lento = ms > LENTO_MS;
    resultados.push({ nome, ok: true, ms, aviso: lento ? `lento (> ${LENTO_MS} ms)` : nota });
  } catch (error) {
    const codigo = error?.cause?.code || error?.cause?.errors?.[0]?.code;
    const motivo =
      error?.name === 'TimeoutError' ? `sem resposta em ${TIMEOUT_MS / 1000} s` : codigo ? `não foi possível conectar (${codigo})` : error?.message === 'fetch failed' ? 'não foi possível conectar' : error?.message || String(error);
    resultados.push({ nome, ok: false, motivo });
  }
}

function exigir(condicao, motivo) {
  if (!condicao) throw new Error(motivo);
}

async function pagina(nome, caminho, { contem } = {}) {
  await verificar(nome, async () => {
    const { res, corpo, ms } = await pedir(caminho, 'text/html');
    exigir(res.status === 200, `esperava 200, veio ${res.status}`);
    if (contem) exigir(corpo.toLowerCase().includes(contem.toLowerCase()), `a resposta não tem "${contem}"`);
    return { ms };
  });
}

async function headersDeSeguranca() {
  await verificar('Headers de segurança na página inicial', async () => {
    const { res, ms } = await pedir('/', 'text/html');
    const h = (nome) => res.headers.get(nome) || '';
    const faltando = [];
    const csp = h('content-security-policy');
    if (!csp) faltando.push('Content-Security-Policy ausente');
    else {
      if (!/'nonce-[A-Za-z0-9+/=_-]+'/.test(csp)) faltando.push("CSP sem 'nonce-…'");
      if (!/frame-ancestors\s+'none'/.test(csp) && h('x-frame-options').toUpperCase() !== 'DENY') faltando.push("sem frame-ancestors 'none' nem X-Frame-Options: DENY");
      if (/script-src[^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'nonce-/.test(csp)) faltando.push("script-src com 'unsafe-inline' sem nonce");
    }
    if (h('x-content-type-options').toLowerCase() !== 'nosniff') faltando.push('X-Content-Type-Options diferente de nosniff');
    if (!h('referrer-policy')) faltando.push('Referrer-Policy ausente');
    if (!h('permissions-policy')) faltando.push('Permissions-Policy ausente');
    if (https && !/max-age=\d+/.test(h('strict-transport-security'))) faltando.push('Strict-Transport-Security ausente (HTTPS)');
    exigir(faltando.length === 0, faltando.join('; '));
    // Duas visitas seguidas precisam de nonces diferentes (nonce fixo não protege nada).
    const outra = (await pedir('/', 'text/html')).res.headers.get('content-security-policy') || '';
    const nonce = (s) => (/'nonce-([^']+)'/.exec(s) || [])[1];
    exigir(nonce(csp) !== nonce(outra), 'o nonce da CSP se repete entre requisições');
    return { ms };
  });
}

async function health() {
  await verificar('API: /api/v1/health', async () => {
    const { res, corpo, ms } = await pedir('/api/v1/health', 'application/json');
    let dados;
    try {
      dados = JSON.parse(corpo);
    } catch {
      throw new Error(`resposta não é JSON (status ${res.status})`);
    }
    const fora = (dados.services || []).filter((s) => s.status === 'down').map((s) => s.name || s.key);
    exigir(res.status === 200, `status ${res.status}${fora.length ? `: fora do ar — ${fora.join(', ')}` : ''}`);
    exigir(['ok', 'degraded'].includes(dados.status), `estado geral "${dados.status}"`);
    const pendentes = (dados.services || []).filter((s) => s.status === 'not_configured').map((s) => s.name || s.key);
    const nota = `${dados.status} · ambiente ${dados.environment ?? '?'} · versão ${dados.version ?? '?'}${pendentes.length ? ` · sem configuração: ${pendentes.join(', ')}` : ''}`;
    return { ms, nota };
  });
}

async function apiJson(nome, caminho, validar) {
  await verificar(nome, async () => {
    const { res, corpo, ms } = await pedir(caminho, 'application/json');
    exigir(res.status === 200, `esperava 200, veio ${res.status}`);
    let dados;
    try {
      dados = JSON.parse(corpo);
    } catch {
      throw new Error('resposta não é JSON');
    }
    validar(dados);
    return { ms };
  });
}

async function naoEncontrado() {
  await verificar('API: rota inexistente responde 404 no formato de erro', async () => {
    const { res, corpo, ms } = await pedir('/api/v1/rota-que-nao-existe-smoke', 'application/json');
    exigir(res.status === 404, `esperava 404, veio ${res.status}`);
    exigir((res.headers.get('content-type') || '').includes('application/problem+json'), 'sem application/problem+json');
    exigir(!/at .+\(.+:\d+:\d+\)/.test(corpo), 'a resposta de erro expõe stack trace');
    return { ms };
  });
}

console.log(`Smoke test em ${base}${bypass ? ' (com bypass da proteção de deploy)' : ''}\n`);

await pagina('Página inicial', '/');
await pagina('Vitrine de campeonatos', '/campeonatos');
await pagina('Termos de uso', '/termos');
await pagina('Política de privacidade', '/privacidade');
await pagina('robots.txt', '/robots.txt', { contem: 'User-agent' });
await pagina('sitemap.xml', '/sitemap.xml', { contem: '<urlset' });
if (CONFERIR_HEADERS) await headersDeSeguranca();
await health();
await apiJson('API: catálogo de jogos', '/api/v1/games', (d) => exigir(Array.isArray(d) && d.length > 0, 'catálogo vazio (o seed rodou?)'));
await apiJson('API: lista pública de campeonatos', '/api/v1/tournaments?limit=1', (d) => exigir(Array.isArray(d.items), 'sem "items" na resposta'));
await naoEncontrado();

let falhas = 0;
for (const r of resultados) {
  if (r.ok) console.log(`  ✓ ${r.nome} — ${r.ms} ms${r.aviso ? ` (${r.aviso})` : ''}`);
  else {
    falhas++;
    console.log(`  ✗ ${r.nome} — ${r.motivo}`);
  }
}
console.log(`\n${resultados.length - falhas} de ${resultados.length} verificações passaram.`);
if (falhas > 0) {
  console.log('Deploy com problema: confira o runbook (docs/runbook.md) e, se o site estiver fora, faça o Instant Rollback.');
  process.exit(1);
}
console.log('Deploy de pé.');
