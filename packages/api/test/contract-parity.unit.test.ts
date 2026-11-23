/**
 * Paridade de contrato do B1 (issue #81): toda rota dos módulos do núcleo na API simulada
 * (`apps/web/mocks/handlers/*`) existe na API real, com o mesmo método e caminho. É isso que permite desligar
 * o mock módulo a módulo sem quebrar as telas. O formato das respostas é conferido em cada rota real
 * (`respond()` valida contra `@nova/schemas`) e nos testes de integração de cada módulo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, createApp, envFrom } from '../src';

const HANDLERS = fileURLToPath(new URL('../../../apps/web/mocks/handlers/', import.meta.url));

/** Módulos do B1 (telas de F1). Os de competição e administração são do B2. */
const B1_MODULES = ['auth', 'users', 'games', 'games-admin', 'tournaments', 'tournaments-manage', 'tournaments-ops', 'teams', 'registrations', 'registrations-manage', 'uploads'];

/** Rotas do mock que, de propósito, não existem (ou mudaram) na API real — cada uma com o motivo. */
const EXPECTED_GAPS: Record<string, string> = {
  'POST /auth/dev-login': 'atalho do protótipo (entrar como outra conta); nunca vai para produção',
  'POST /uploads/token': 'o envio real usa o `@vercel/blob/client` em `/uploads/blob` (#73)',
  'PUT /uploads/:param': 'o arquivo vai direto para o Blob; a confirmação é `/uploads/complete` (#73)',
};

/** `/teams/:id/members/:userId` → `/teams/:param/members/:param` (o nome do parâmetro não importa). */
const normalize = (path: string) => path.replace(/:[A-Za-z]+/g, ':param');

function mockRoutes(modules: string[] = B1_MODULES): Set<string> {
  const routes = new Set<string>();
  for (const name of modules) {
    const source = readFileSync(`${HANDLERS}${name}.ts`, 'utf8');
    for (const match of source.matchAll(/http\.(get|post|put|patch|delete)\(\s*url\('([^']+)'\)/g)) {
      routes.add(`${(match[1] ?? '').toUpperCase()} ${normalize(match[2] ?? '')}`);
    }
  }
  return routes;
}

function realRoutes(): Set<string> {
  const app = createApp({ env: envFrom({ NODE_ENV: 'test' }) });
  return new Set(
    app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith(`${API_BASE_PATH}/`))
      .map((r) => `${r.method} ${normalize(r.path.slice(API_BASE_PATH.length))}`),
  );
}

describe('paridade de contrato do B1', () => {
  const mock = mockRoutes();
  const real = realRoutes();

  it('lê as rotas do mock (sanidade do leitor)', () => {
    expect(mock.size).toBeGreaterThan(60);
    expect(mock).toContain('POST /tournaments/:param/registrations');
  });

  it('toda rota do núcleo na API simulada existe na API real (exceto as lacunas registradas)', () => {
    const missing = [...mock].filter((route) => !real.has(route) && !(route in EXPECTED_GAPS)).sort();
    expect(missing).toEqual([]);
  });

  it('as lacunas registradas continuam sendo lacunas (quando a rota chegar, sai da lista)', () => {
    const closed = Object.keys(EXPECTED_GAPS).filter((route) => real.has(route));
    expect(closed).toEqual([]);
    // E nenhuma lacuna inventada: cada uma existe de verdade na API simulada.
    expect(Object.keys(EXPECTED_GAPS).filter((route) => !mock.has(route))).toEqual([]);
  });
});

/**
 * B2: notificações (#98) e a verificação em duas etapas (#95, parte de `admin-settings`). O resto de
 * `admin-settings` (configurações, flags, saúde) é de outra issue e não entra aqui.
 */
describe('paridade de contrato: notificações e 2FA', () => {
  const real = realRoutes();

  it('toda rota de notificações da API simulada existe na API real', () => {
    const mock = mockRoutes(['notifications']);
    expect(mock.size).toBeGreaterThanOrEqual(6);
    expect([...mock].filter((route) => !real.has(route))).toEqual([]);
  });

  it('as rotas de 2FA existem; o código de demonstração (`/me/2fa/dev-code`) não', () => {
    const mock = [...mockRoutes(['admin-settings'])].filter((route) => route.includes('/2fa'));
    expect(mock.length).toBeGreaterThanOrEqual(6);
    expect(mock.filter((route) => !real.has(route))).toEqual(['GET /me/2fa/dev-code']);
    expect(real.has('POST /auth/2fa/verify')).toBe(true);
  });
});

/**
 * Atalhos do protótipo (issue #102): existem só na API simulada (MSW) e nunca na real — nem como rota, nem como campo
 * de resposta. A lista é a de `apps/web/README.md` ("Atalhos que só existem no protótipo").
 */
describe('atalhos do protótipo não existem na API real', () => {
  const real = realRoutes();
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  }

  it('sem `POST /auth/dev-login` nem `GET /me/2fa/dev-code`; o mock continua tendo os dois', () => {
    expect(real.has('POST /auth/dev-login')).toBe(false);
    expect(real.has('GET /me/2fa/dev-code')).toBe(false);
    expect([...real].filter((route) => /dev[-_]?(login|code)/i.test(route))).toEqual([]);
    expect(mockRoutes(['auth'])).toContain('POST /auth/dev-login');
    expect(mockRoutes(['admin-settings'])).toContain('GET /me/2fa/dev-code');
  });

  it('nenhum código da API devolve `devVerifyToken`, `devResetToken` ou o código de demonstração do 2FA', () => {
    const offenders = sources(SRC).filter((file) => {
      // Comentários podem citar os atalhos (para dizer que não existem); código, não.
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return /devVerifyToken|devResetToken|dev-login|dev-code|TwoFactorDevCode/.test(code);
    });
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});

/** #102 (Marco M2): **todo** módulo da API simulada tem a API real — preview e staging rodam com `NEXT_PUBLIC_API_MOCK=none`. */
describe('paridade de contrato: todos os módulos', () => {
  const real = realRoutes();
  const all = readdirSync(HANDLERS)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, ''));

  it('toda rota de todo módulo do mock existe na API real (exceto as lacunas registradas e o atalho do 2FA)', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    const mock = mockRoutes(all);
    expect(mock.size).toBeGreaterThan(180);
    const missing = [...mock].filter((route) => !real.has(route) && !(route in EXPECTED_GAPS) && route !== 'GET /me/2fa/dev-code').sort();
    expect(missing).toEqual([]);
  });
});
