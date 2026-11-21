/**
 * Paridade de contrato do pós-lançamento B (issues 121 e 125): toda rota dos módulos `discord`, `chat` e `calendar`
 * da API simulada existe na API real, com o mesmo método e caminho. O formato das respostas é conferido por
 * `respond()` e pelos testes de integração de cada rota.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, createApp, envFrom } from '../src';

const HANDLERS = fileURLToPath(new URL('../../../apps/web/mocks/handlers/', import.meta.url));
const MODULES = ['discord', 'chat', 'calendar'];
const normalize = (path: string) => path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, ':param');

function mockRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const name of MODULES) {
    const source = readFileSync(`${HANDLERS}${name}.ts`, 'utf8');
    for (const match of source.matchAll(/http\.(get|post|put|patch|delete)\(\s*url\('([^']+)'\)/g)) routes.add(`${(match[1] ?? '').toUpperCase()} ${normalize(match[2] ?? '')}`);
  }
  return routes;
}

describe('paridade de contrato do pós-lançamento B', () => {
  const mock = mockRoutes();
  const app = createApp({ env: envFrom({ NODE_ENV: 'test' }) });
  const real = new Set(app.routes.filter((r) => r.method !== 'ALL' && r.path.startsWith(`${API_BASE_PATH}/`)).map((r) => `${r.method} ${normalize(r.path.slice(API_BASE_PATH.length))}`));

  it('toda rota do bot do Discord, do chat e do calendário na API simulada existe na API real', () => {
    expect([...mock].filter((route) => !real.has(route)).sort()).toEqual([]);
  });
});
