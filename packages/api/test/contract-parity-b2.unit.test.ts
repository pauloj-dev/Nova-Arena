/**
 * Paridade de contrato da competição (B2: #82 a #90, #100): toda rota dos módulos `competition`, `submissions` e
 * `profile-stats` da API simulada existe na API real, com o mesmo método e caminho. O formato das respostas é
 * conferido por `respond()` e pelos testes de integração de cada rota.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, createApp, envFrom } from '../src';

const HANDLERS = fileURLToPath(new URL('../../../apps/web/mocks/handlers/', import.meta.url));
const B2_MODULES = ['competition', 'submissions', 'profile-stats'];
const normalize = (path: string) => path.replace(/:[A-Za-z]+/g, ':param');

function mockRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const name of B2_MODULES) {
    const source = readFileSync(`${HANDLERS}${name}.ts`, 'utf8');
    for (const match of source.matchAll(/http\.(get|post|put|patch|delete)\(\s*url\('([^']+)'\)/g)) routes.add(`${(match[1] ?? '').toUpperCase()} ${normalize(match[2] ?? '')}`);
  }
  return routes;
}

describe('paridade de contrato da competição (B2)', () => {
  const mock = mockRoutes();
  const app = createApp({ env: envFrom({ NODE_ENV: 'test' }) });
  const real = new Set(app.routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${API_BASE_PATH}/`)).map((r) => `${r.method} ${normalize(r.path.slice(API_BASE_PATH.length))}`));

  it('lê as rotas do mock (sanidade do leitor)', () => {
    expect(mock.size).toBeGreaterThan(35);
    expect(mock).toContain('PUT /matches/:param/result');
    expect(mock).toContain('POST /disputes/:param/resolve');
    expect(mock).toContain('GET /users/:param/stats');
  });

  it('toda rota de competição, envio/disputa e perfil competitivo da API simulada existe na API real', () => {
    expect([...mock].filter((route) => !real.has(route)).sort()).toEqual([]);
  });
});
