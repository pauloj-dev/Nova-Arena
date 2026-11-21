/**
 * Painel do Administrador na API real (B2.6/B2.8, issues #91, #92, #93, #96, #101). Toda rota `/admin/*` passa antes
 * por `adminArea` (Admin ou Super Admin com 2FA feito), registrado no `app.ts`.
 *
 * - `users.ts`: usuários, sanções, redefinição de senha, mescla (RN-13).
 * - `roles.ts`: convites, papéis (RN-11), organizadores e limites (RN-10), pedidos de organizador; aceite do convite.
 * - `tournaments.ts`: campeonatos (RN-09, fila "Sem responsável"), comunicados globais e `GET /site/banner`.
 * - `audit.ts`: consulta e exportação da auditoria; `GET /tournaments/:id/audit-logs`.
 * - `stats.ts`: KPIs do dashboard e métricas de produto.
 * - `GET /cron/sanctions` (Cron da Vercel, a cada minuto): suspensões vencidas voltam a ficar ativas sozinhas.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../context';
import { requireCron } from '../../jobs';
import { runJob } from '../../jobs/runner';
import { adminAudit } from './audit';
import { adminRoles } from './roles';
import { expireSuspensions } from './sanctions';
import { adminStats } from './stats';
import { adminTournaments } from './tournaments';
import { adminUsers } from './users';

export const adminCron = new Hono<AppEnv>().get('/cron/sanctions', requireCron, async (c) => {
  const { db, now } = c.get('deps');
  const expired = await runJob(c, 'cron:sanctions', 'cron', () => expireSuspensions(db(), now()));
  if (expired > 0) c.get('log').info('suspensões vencidas', { contas: expired });
  return c.json({ ok: true, expired });
});

export const adminModules = [adminUsers, adminRoles, adminTournaments, adminAudit, adminStats, adminCron];
