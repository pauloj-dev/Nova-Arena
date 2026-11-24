/**
 * Paridade de contrato dos eventos (ADR-0005): toda rota do módulo `events` da API simulada existe na API real, com o
 * mesmo método e caminho, e vice-versa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, createApp, envFrom } from '../src';

const HANDLERS = fileURLToPath(new URL('../../../apps/web/mocks/handlers/', import.meta.url));
const normalize = (path: string) => path.replace(/:[A-Za-z]+/g, ':param');

function mockRoutes(): Set<string> {
  const routes = new Set<string>();
  const source = readFileSync(`${HANDLERS}events.ts`, 'utf8');
  for (const match of source.matchAll(/http\.(get|post|put|patch|delete)\(\s*url\('([^']+)'\)/g)) routes.add(`${(match[1] ?? '').toUpperCase()} ${normalize(match[2] ?? '')}`);
  return routes;
}

describe('paridade de contrato dos eventos', () => {
  const mock = mockRoutes();
  const app = createApp({ env: envFrom({ NODE_ENV: 'test' }) });
  const real = new Set(app.routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${API_BASE_PATH}/`)).map((r) => `${r.method} ${normalize(r.path.slice(API_BASE_PATH.length))}`));
  // `POST /events` é outra coisa: as métricas de produto (`modules/site/events`).
  const EVENT_ROUTES = /^(GET \/events\/|(GET|POST|PATCH|DELETE) \/organizer\/events(\/|$))/;

  it('lê as rotas do mock (sanidade do leitor)', () => {
    expect(mock.size).toBe(8);
    expect(mock).toContain('GET /events/:param');
    expect(mock).toContain('POST /organizer/events/:param/tournaments');
  });

  it('toda rota do mock existe na API real, e a API real não tem rota de evento a mais', () => {
    expect([...mock].filter((route) => !real.has(route)).sort()).toEqual([]);
    expect([...real].filter((route) => EVENT_ROUTES.test(route) && !mock.has(route)).sort()).toEqual([]);
  });
});
