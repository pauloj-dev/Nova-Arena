/**
 * Configuração comum dos testes de carga (issue #112). Tudo vem de variáveis de ambiente do k6 (`-e NOME=valor`):
 *
 * - `BASE_URL` (obrigatória): URL do staging, sem barra no fim. Ex.: `https://staging.novaarena.gg`.
 * - `VERCEL_AUTOMATION_BYPASS_SECRET`: segredo do "Protection Bypass for Automation" (Deployment Protection).
 * - `ESCALA`: multiplica o número de usuários (0.01 = ensaio com 1% da carga; 1 = carga cheia). Padrão 1.
 * - `PREFIXO`: prefixo do nome dos campeonatos criados pelo k6 (padrão `Carga k6`).
 * - `CARGA_K6_SEGREDO`: o mesmo valor da regra "Liberar gerador de carga (k6)" do Firewall (`ops/firewall`),
 *   mandado no cabeçalho `x-carga-k6` para o gerador passar pelos limites da borda.
 *
 * Nunca aponte para produção: o script recusa domínios que não pareçam staging/preview, a não ser que
 * `PERMITIR_QUALQUER_HOST=1` seja passado de propósito (ex.: ensaio local em http://localhost:3151).
 */
import exec from 'k6/execution';

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
export const API = `${BASE_URL}/api/v1`;
export const ESCALA = Number(__ENV.ESCALA || '1');
export const PREFIXO = __ENV.PREFIXO || 'Carga k6';
const BYPASS = __ENV.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const SEGREDO_CARGA = __ENV.CARGA_K6_SEGREDO || '';

if (!BASE_URL) {
  throw new Error('Defina BASE_URL (ex.: -e BASE_URL=https://staging.novaarena.gg).');
}
const host = BASE_URL.replace(/^https?:\/\//, '').split('/')[0];
const pareceStaging = /staging|preview|\.vercel\.app$|^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host);
if (!pareceStaging && __ENV.PERMITIR_QUALQUER_HOST !== '1') {
  throw new Error(`BASE_URL "${host}" não parece staging. Teste de carga nunca roda contra produção. Para outro host, passe -e PERMITIR_QUALQUER_HOST=1.`);
}

/** Usuários virtuais já multiplicados pela escala (mínimo 1). */
export function vus(n) {
  return Math.max(1, Math.round(n * ESCALA));
}

/** Cabeçalhos de toda requisição: identificação do gerador e o bypass da proteção de deploy. */
export function baseHeaders(extra = {}) {
  const headers = { 'User-Agent': 'nova-arena-k6/1.0 (teste de carga #112)', ...extra };
  if (BYPASS) {
    headers['x-vercel-protection-bypass'] = BYPASS;
    // Faz a Vercel gravar o cookie de bypass: as próximas requisições do mesmo VU passam sem o cabeçalho também.
    headers['x-vercel-set-bypass-cookie'] = 'true';
  }
  if (SEGREDO_CARGA) headers['x-carga-k6'] = SEGREDO_CARGA;
  return headers;
}

/**
 * Metas do PRD (RNF-01 a RNF-04, plano R2 "Testes"):
 * - API de leitura p95 ≤ 300 ms; API de escrita p95 ≤ 600 ms;
 * - menos de 1% de erro; nenhuma falha de conexão com o banco (o 5xx entra no `http_req_failed`).
 * Páginas HTML (servidas pela CDN/ISR) têm meta própria, mais larga, só informativa para o relatório.
 */
export const METAS = {
  'http_req_duration{tipo:leitura}': ['p(95)<300'],
  'http_req_duration{tipo:escrita}': ['p(95)<600'],
  'http_req_duration{tipo:pagina}': ['p(95)<1000'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  erros_servidor: ['count<1'],
};

/** Um ID curto e único por VU e iteração (chaves de idempotência, nomes). */
export function idUnico(prefixo = 'k6') {
  return `${prefixo}-${exec.vu.idInTest}-${exec.vu.iterationInInstance}-${Date.now().toString(36)}`;
}
