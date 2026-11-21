/**
 * Paridade de contrato do B1 (issue #81): toda rota dos módulos do núcleo na API simulada
 * (`apps/web/mocks/handlers/*`) existe na API real, com o mesmo método e caminho. É isso que permite desligar
 * o mock módulo a módulo sem quebrar as telas. O formato das respostas é conferido em cada rota real
 * (`respond()` valida contra `@nova/schemas`) e nos testes de integração de cada módulo.
 */
import { readFileSync } from 'node:fs';
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
  'GET /games/:param/ranking': 'ranking por jogo sai dos resultados das partidas (B2)',
  'GET /me/follows': 'seguir campeonato ou jogo (RN-15) entra com as notificações (#98)',
  'PUT /me/follows/:param/:param': 'seguir campeonato ou jogo (RN-15) entra com as notificações (#98)',
  'DELETE /me/follows/:param/:param': 'seguir campeonato ou jogo (RN-15) entra com as notificações (#98)',
  'GET /role-invites/:param': 'convites de Admin e Organizador (#92)',
  'POST /role-invites/:param/accept': 'convites de Admin e Organizador (#92)',
};

/** `/teams/:id/members/:userId` → `/teams/:param/members/:param` (o nome do parâmetro não importa). */
const normalize = (path: string) => path.replace(/:[A-Za-z]+/g, ':param');

function mockRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const name of B1_MODULES) {
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
