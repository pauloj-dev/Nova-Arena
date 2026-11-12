/**
 * Registro dos módulos da API simulada.
 *
 * `NEXT_PUBLIC_API_MOCK` controla o que é simulado:
 *   - `all` (padrão do protótipo): tudo simulado;
 *   - `none`: nada simulado (API real);
 *   - lista separada por vírgula (`auth,games`): só esses módulos simulados — é assim que
 *     as telas trocam o mock pela API real, módulo a módulo, em B1 e B2.
 */
import type { HttpHandler } from 'msw';
import * as auth from './auth';
import * as games from './games';
import * as gamesAdmin from './games-admin';
import * as registrations from './registrations';
import * as registrationsManage from './registrations-manage';
import * as teams from './teams';
import * as tournaments from './tournaments';
import * as tournamentsManage from './tournaments-manage';
import * as users from './users';

interface MockModule {
  moduleName: string;
  handlers: HttpHandler[];
}

// A ordem importa: rotas mais específicas (ex.: `/tournaments/mine`) precisam vir antes das genéricas (`/tournaments/:slug`).
export const modules: MockModule[] = [auth, users, gamesAdmin, games, tournamentsManage, registrationsManage, registrations, tournaments, teams];

export function mockSetting(): string {
  return process.env.NEXT_PUBLIC_API_MOCK ?? 'all';
}

export function isMockEnabled(): boolean {
  return mockSetting() !== 'none';
}

export function enabledHandlers(setting: string = mockSetting()): HttpHandler[] {
  if (setting === 'none') return [];
  if (setting === 'all') return modules.flatMap((m) => m.handlers);
  const wanted = new Set(setting.split(',').map((s) => s.trim()));
  return modules.filter((m) => wanted.has(m.moduleName)).flatMap((m) => m.handlers);
}
