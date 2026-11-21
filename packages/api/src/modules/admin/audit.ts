/**
 * Consulta da auditoria (issue #93, ADM-08, RF-06, RNF-15). Porta das rotas de `apps/web/mocks/handlers/admin-audit.ts`.
 *
 * - **Somente leitura:** só existem rotas `GET`. Quem grava é `audited()`/o gatilho de `user_roles`, na transação de
 *   cada ação; o banco recusa UPDATE/DELETE em `audit_logs`.
 * - `GET /admin/audit-logs` com filtros (ação, tipo, recurso, campeonato, quem, período), 20 por página.
 * - `GET /admin/audit-logs.csv`: **em streaming**, em blocos de 1.000 por chave (data, id) — exportar um ano não
 *   carrega tudo na memória nem espera a consulta inteira para começar a responder. BOM + `;` (Excel pt-BR) e
 *   célula que começaria com `=`, `+`, `-` ou `@` ganha apóstrofo (não vira fórmula).
 * - `GET /tournaments/:id/audit-logs`: o organizador (dono ou co-organizador) vê só os do próprio campeonato.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { AUDIT_ACTIONS, AuditLog, AuditMeta, auditActionLabel, numberedPage } from '@nova/schemas';
import { Hono } from 'hono';
import { requireAdmin } from '../../auth/admin';
import { assertTournamentAccess } from '../../auth/rbac';
import { respond, type AppContext, type AppEnv } from '../../context';
import { isUuid, normalize, pageOf } from './shared';

export const AUDIT_PAGE_SIZE = 20;
const CSV_CHUNK = 1000;
const BOM = String.fromCharCode(0xfeff);

export const ENTITY_LABELS: Record<string, string> = {
  User: 'Usuário',
  Tournament: 'Campeonato',
  Stage: 'Fase',
  Match: 'Partida',
  Registration: 'Inscrição',
  Game: 'Jogo',
  ScoringModel: 'Modelo de pontuação',
  RoleInvite: 'Convite',
  OrganizerRequest: 'Pedido de organizador',
  Report: 'Denúncia',
  Dispute: 'Disputa',
  SiteSettings: 'Configurações',
  FeatureFlag: 'Recurso',
  GlobalAnnouncement: 'Comunicado',
};

export const adminAudit = new Hono<AppEnv>();

/** Início do dia (UTC) para `from` e fim do dia para `to`, quando vêm só como data. */
export function boundary(value: string | undefined | null, end: boolean): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time);
}

/** Filtros da consulta. `null` = nenhum registro pode bater (ex.: id fora do formato). */
async function whereOf(db: PrismaClient, q: (key: string) => string | undefined): Promise<Prisma.AuditLogWhereInput | null> {
  const where: Prisma.AuditLogWhereInput = {};
  const action = q('action');
  const entityType = q('entityType');
  const entityId = q('entityId');
  const tournamentId = q('tournamentId');
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (tournamentId) {
    if (!isUuid(tournamentId)) return null;
    where.tournamentId = tournamentId;
  }
  const from = boundary(q('from'), false);
  const to = boundary(q('to'), true);
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const actor = (q('actor') ?? '').trim();
  if (actor) {
    if (isUuid(actor)) where.actorId = actor;
    else {
      const ids = (await db.user.findMany({ where: { nicknameKey: { contains: normalize(actor) } }, select: { id: true }, take: 500 })).map((u) => u.id);
      if (ids.length === 0) return null;
      where.actorId = { in: ids };
    }
  }
  return where;
}

type AuditRow = { id: bigint; actorId: string | null; action: string; entityType: string; entityId: string; entityLabel: string; tournamentId: string | null; before: unknown; after: unknown; reason: string | null; ip: string | null; createdAt: Date };
const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

async function actorNames(db: PrismaClient, rows: AuditRow[], cache = new Map<string, string>()): Promise<Map<string, string>> {
  const missing = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id && !cache.has(id)))];
  if (missing.length > 0) for (const u of await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, nickname: true } })) cache.set(u.id, u.nickname);
  return cache;
}

export function toAuditLog(l: AuditRow, names: Map<string, string>): AuditLog {
  return {
    id: String(l.id),
    actorId: l.actorId,
    actorNickname: (l.actorId && names.get(l.actorId)) || 'Sistema',
    action: l.action,
    actionLabel: auditActionLabel(l.action),
    entityType: l.entityType,
    entityId: l.entityId,
    entityLabel: l.entityLabel,
    tournamentId: l.tournamentId,
    before: asRecord(l.before),
    after: asRecord(l.after),
    reason: l.reason,
    ip: l.ip ?? '',
    createdAt: l.createdAt.toISOString(),
  };
}

const ORDER: Prisma.AuditLogOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

async function listPage(c: AppContext, q: (key: string) => string | undefined) {
  const db = c.get('deps').db();
  const where = await whereOf(db, q);
  if (!where) return { items: [], page: 1, pageCount: 1, total: 0 };
  const total = await db.auditLog.count({ where });
  const page = pageOf(q('page'), total, AUDIT_PAGE_SIZE);
  const rows = await db.auditLog.findMany({ where, orderBy: ORDER, skip: page.skip, take: page.take });
  const names = await actorNames(db, rows);
  return { items: rows.map((r) => toAuditLog(r, names)), page: page.page, pageCount: page.pageCount, total };
}

adminAudit.get('/admin/audit-logs', async (c) => {
  await requireAdmin(c);
  return respond(c, numberedPage(AuditLog), await listPage(c, (key) => c.req.query(key)));
});

/** Opções dos filtros da tela de auditoria. */
adminAudit.get('/admin/audit-logs/meta', async (c) => {
  await requireAdmin(c);
  const used = await c.get('deps').db().auditLog.groupBy({ by: ['entityType'] });
  const meta: AuditMeta = {
    actions: Object.entries(AUDIT_ACTIONS)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    entityTypes: [...new Set([...Object.keys(ENTITY_LABELS), ...used.map((u) => u.entityType)])],
  };
  return respond(c, AuditMeta, meta);
});

// ── CSV ──────────────────────────────────────────────────────────────
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = ['Data (UTC)', 'Quem', 'Ação', 'Recurso', 'Tipo', 'ID do recurso', 'Campeonato', 'Motivo', 'Antes', 'Depois', 'IP'];

function csvRow(l: AuditLog): string {
  return [l.createdAt, l.actorNickname, l.actionLabel, l.entityLabel, ENTITY_LABELS[l.entityType] ?? l.entityType, l.entityId, l.tournamentId, l.reason, l.before, l.after, l.ip].map(csvCell).join(';');
}

/** Exportação com os mesmos filtros da consulta, em streaming. */
adminAudit.get('/admin/audit-logs.csv', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  const where = await whereOf(db, (key) => c.req.query(key));
  const log = c.get('log');
  const encoder = new TextEncoder();
  const names = new Map<string, string>();
  let cursor: { createdAt: Date; id: bigint } | null = null;
  let exported = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // BOM: abre certo no Excel em pt-BR.
      controller.enqueue(encoder.encode(`${BOM}${CSV_HEADER.map(csvCell).join(';')}\r\n`));
      if (!where) controller.close();
    },
    async pull(controller) {
      if (!where) return;
      try {
        const page: AuditRow[] = await db.auditLog.findMany({
          where: cursor ? { AND: [where, { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : where,
          orderBy: ORDER,
          take: CSV_CHUNK,
        });
        if (page.length > 0) {
          await actorNames(db, page, names);
          controller.enqueue(encoder.encode(`${page.map((r) => csvRow(toAuditLog(r, names))).join('\r\n')}\r\n`));
          exported += page.length;
          const last = page[page.length - 1] as AuditRow;
          cursor = { createdAt: last.createdAt, id: last.id };
        }
        if (page.length < CSV_CHUNK) {
          log.info('auditoria exportada', { linhas: exported });
          controller.close();
        }
      } catch (error) {
        log.error('falha ao exportar a auditoria', { linhas: exported, error: error instanceof Error ? error.message : String(error) });
        controller.error(error);
      }
    },
  });
  return c.body(stream, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="auditoria-${now().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store',
  });
});

/** PRD §6, nota 2: o organizador vê só os logs dos próprios campeonatos (dono, co-organizador ou Admin). */
adminAudit.get('/tournaments/:id/audit-logs', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  // O filtro de campeonato não pode ser trocado pela query string.
  const q = (key: string) => (key === 'tournamentId' ? access.tournamentId : c.req.query(key));
  return respond(c, numberedPage(AuditLog), await listPage(c, q));
});
