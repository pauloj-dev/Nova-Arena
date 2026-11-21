/**
 * Paridade de contrato do ranking de temporada e das ligas (issue #120): toda rota do módulo `seasons` da API
 * simulada existe na API real, com o mesmo método e caminho, e vice-versa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, createApp, envFrom } from '../src';

const HANDLERS = fileURLToPath(new URL('../../../apps/web/mocks/handlers/', import.meta.url));
const MODULES = ['seasons'];
const normalize = (path: string) => path.replace(/:[A-Za-z]+/g, ':param');

function mockRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const name of MODULES) {
    const source = readFileSync(`${HANDLERS}${name}.ts`, 'utf8');
    for (const match of source.matchAll(/http\.(get|post|put|patch|delete)\(\s*url\('([^']+)'\)/g)) routes.add(`${(match[1] ?? '').toUpperCase()} ${normalize(match[2] ?? '')}`);
  }
  return routes;
}

describe('paridade de contrato do ranking de temporada e das ligas', () => {
  const mock = mockRoutes();
  const app = createApp({ env: envFrom({ NODE_ENV: 'test' }) });
  const real = new Set(app.routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${API_BASE_PATH}/`)).map((r) => `${r.method} ${normalize(r.path.slice(API_BASE_PATH.length))}`));
  const SEASON_ROUTES = /^(GET|POST|PATCH|DELETE) \/(seasons|admin\/seasons|leagues|organizer\/leagues|games\/:param\/season-ranking|users\/:param\/rating|teams\/:param\/rating)/;

  it('lê as rotas do mock (sanidade do leitor)', () => {
    expect(mock.size).toBe(15);
    expect(mock).toContain('GET /games/:param/season-ranking');
    expect(mock).toContain('POST /organizer/leagues/:param/tournaments');
  });

  it('toda rota do mock existe na API real, e a API real não tem rota de temporada ou liga a mais', () => {
    expect([...mock].filter((route) => !real.has(route)).sort()).toEqual([]);
    expect([...real].filter((route) => SEASON_ROUTES.test(route) && !mock.has(route)).sort()).toEqual([]);
  });
});
