/**
 * Antifraude (issue #114, PRD §16.5 e §22 R1/R4): detecção de sinais e abertura de alertas para a moderação.
 *
 * - **Várias contas por IP/aparelho:** a cada sessão nova (login, cadastro, OAuth) conta as contas distintas que
 *   entraram do mesmo IP (24 h) e do mesmo aparelho (30 dias). O aparelho é o cookie `na_dev` (UUID aleatório,
 *   `httpOnly`, sem dado pessoal; necessário para a segurança da conta, por isso fora do banner de cookies).
 * - **ID de jogo repetido:** ao salvar um ID de jogo, procura o mesmo ID (normalizado) em outras contas.
 * - **Ações administrativas em massa (R4):** depois de cada alteração bem-sucedida em `/admin/*`, conta na auditoria
 *   as ações do mesmo Admin no último minuto (banimentos, sanções, mudanças de papel, cancelamentos). Passou do
 *   limite → alerta e aviso ao Super Admin.
 *
 * Nada aqui derruba a requisição: a detecção roda depois da ação e falha só vai para o log. Um alerta aberto por
 * `dedupeKey`: a repetição soma `occurrences` no mesmo alerta (dentro de `FRAUD_THRESHOLDS.dedupeHours`).
 */
import type { FraudAlertKind as DbFraudAlertKind, Prisma, PrismaClient } from '@nova/db';
import { FRAUD_THRESHOLDS, MASS_ACTION_LABELS, maskAlertIp, type FraudSeverity, type MassActionKind } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from './context';
import { notify } from './notify';
import { messages } from './messages/pt-BR';

const HOUR_MS = 3600_000;
const DEVICE_COOKIE = 'na_dev';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AlertInput {
  kind: DbFraudAlertKind;
  severity: FraudSeverity;
  dedupeKey: string;
  userIds: string[];
  actorId?: string | null;
  details: Record<string, string | number | boolean | null>;
}

/** Abre o alerta ou soma no alerta aberto com a mesma chave. Devolve se é novo. */
export async function raiseAlert(db: PrismaClient, now: Date, input: AlertInput): Promise<{ id: string; created: boolean }> {
  const since = new Date(now.getTime() - FRAUD_THRESHOLDS.dedupeHours * HOUR_MS);
  const open = await db.fraudAlert.findFirst({ where: { dedupeKey: input.dedupeKey, status: 'OPEN', lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: 'desc' } });
  const details = input.details as Prisma.InputJsonObject;
  if (open) {
    const userIds = [...new Set([...open.userIds, ...input.userIds])];
    await db.fraudAlert.update({ where: { id: open.id }, data: { occurrences: { increment: 1 }, lastSeenAt: now, userIds, details, severity: input.severity } });
    return { id: open.id, created: false };
  }
  const created = await db.fraudAlert.create({
    data: { kind: input.kind, severity: input.severity, dedupeKey: input.dedupeKey, userIds: [...new Set(input.userIds)], actorId: input.actorId ?? null, details, firstSeenAt: now, lastSeenAt: now },
  });
  return { id: created.id, created: true };
}

/** Roda a detecção sem derrubar a requisição. */
async function safely(c: AppContext, what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    c.get('log').warn('antifraude: verificação falhou', { what, error: error instanceof Error ? error.message : String(error) });
  }
}

// ── Aparelho ─────────────────────────────────────────────────────────

/** Id do aparelho (cookie `na_dev`); cria um se ainda não houver. */
export function deviceIdOf(c: AppContext): string {
  const current = getCookie(c, DEVICE_COOKIE);
  if (current && UUID.test(current)) return current;
  const id = randomUUID();
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, DEVICE_COOKIE, id, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 400 * 24 * 3600 });
  return id;
}

// ── Várias contas por IP / aparelho ──────────────────────────────────

export async function checkSessionSignals(c: AppContext, userId: string, ip: string | null, deviceId: string | null): Promise<void> {
  await safely(c, 'contas por IP/aparelho', async () => {
    const db = c.get('deps').db();
    const now = c.get('deps').now();
    if (ip && ip !== 'desconhecido') {
      const since = new Date(now.getTime() - FRAUD_THRESHOLDS.ipWindowHours * HOUR_MS);
      const rows = await db.session.findMany({ where: { ip, createdAt: { gte: since } }, distinct: ['userId'], select: { userId: true }, take: 100 });
      if (rows.length >= FRAUD_THRESHOLDS.ipAccounts && rows.some((r) => r.userId === userId)) {
        await raiseAlert(db, now, {
          kind: 'MULTI_ACCOUNT_IP',
          severity: rows.length >= FRAUD_THRESHOLDS.ipAccounts * 2 ? 'HIGH' : 'MEDIUM',
          dedupeKey: `MULTI_ACCOUNT_IP:${ip}`,
          userIds: rows.map((r) => r.userId),
          details: { ip: maskAlertIp(ip), accounts: rows.length, windowHours: FRAUD_THRESHOLDS.ipWindowHours, threshold: FRAUD_THRESHOLDS.ipAccounts },
        });
      }
    }
    if (deviceId) {
      const since = new Date(now.getTime() - FRAUD_THRESHOLDS.deviceWindowDays * 24 * HOUR_MS);
      const rows = await db.session.findMany({ where: { deviceId, createdAt: { gte: since } }, distinct: ['userId'], select: { userId: true }, take: 100 });
      if (rows.length >= FRAUD_THRESHOLDS.deviceAccounts && rows.some((r) => r.userId === userId)) {
        await raiseAlert(db, now, {
          kind: 'MULTI_ACCOUNT_DEVICE',
          severity: rows.length >= FRAUD_THRESHOLDS.deviceAccounts * 2 ? 'HIGH' : 'MEDIUM',
          dedupeKey: `MULTI_ACCOUNT_DEVICE:${deviceId}`,
          userIds: rows.map((r) => r.userId),
          details: { accounts: rows.length, windowDays: FRAUD_THRESHOLDS.deviceWindowDays, threshold: FRAUD_THRESHOLDS.deviceAccounts },
        });
      }
    }
  });
}

// ── ID de jogo repetido ──────────────────────────────────────────────

/** ID normalizado: sem espaços e em minúsculas. */
export const normalizeGameKey = (value: string | undefined | null): string | null => {
  const key = (value ?? '').replace(/\s+/g, '').toLowerCase();
  return key.length > 0 ? key : null;
};

export async function checkDuplicateGameId(c: AppContext, userId: string, game: { id: string; name: string }, externalKey: string | null): Promise<void> {
  if (!externalKey) return;
  await safely(c, 'ID de jogo repetido', async () => {
    const db = c.get('deps').db();
    const others = await db.gameAccount.findMany({ where: { gameId: game.id, externalKey, userId: { not: userId }, user: { status: { notIn: ['DELETED', 'MERGED'] } } }, select: { userId: true }, take: 20 });
    if (others.length === 0) return;
    await raiseAlert(db, c.get('deps').now(), {
      kind: 'DUPLICATE_GAME_ID',
      severity: 'HIGH',
      dedupeKey: `DUPLICATE_GAME_ID:${game.id}:${externalKey}`,
      userIds: [userId, ...others.map((o) => o.userId)],
      details: { game: game.name, gameId: game.id, playerId: externalKey, accounts: others.length + 1 },
    });
  });
}

// ── Ações administrativas em massa ───────────────────────────────────

interface MassCounts {
  BAN: number;
  SANCTION: number;
  ROLE_CHANGE: number;
  TOURNAMENT_CANCEL: number;
}

/** Ações do Admin na janela, por tipo (lidas da auditoria, que é a fonte de verdade — inclusive dos papéis). */
export async function countAdminActions(db: PrismaClient, actorId: string, since: Date): Promise<MassCounts> {
  const [row] = await db.$queryRaw<{ ban: bigint; sanction: bigint; role: bigint; cancel: bigint }[]>`
    SELECT
      count(*) FILTER (WHERE action = 'USER_SANCTIONED' AND after->>'sancao' = 'BAN') AS ban,
      count(*) FILTER (WHERE action = 'USER_SANCTIONED') AS sanction,
      count(*) FILTER (WHERE action IN ('ROLE_GRANTED', 'ROLE_REVOKED')) AS role,
      count(*) FILTER (WHERE action = 'TOURNAMENT_STATUS_CHANGED' AND after->>'status' = 'CANCELLED') AS cancel
    FROM audit_logs
    WHERE "actorId" = ${actorId}::uuid AND "createdAt" >= ${since}`;
  return { BAN: Number(row?.ban ?? 0), SANCTION: Number(row?.sanction ?? 0), ROLE_CHANGE: Number(row?.role ?? 0), TOURNAMENT_CANCEL: Number(row?.cancel ?? 0) };
}

export async function checkMassAdminActions(c: AppContext, actorId: string): Promise<void> {
  await safely(c, 'ações em massa', async () => {
    const db = c.get('deps').db();
    const now = c.get('deps').now();
    const counts = await countAdminActions(db, actorId, new Date(now.getTime() - FRAUD_THRESHOLDS.massWindowSeconds * 1000));
    // Banimento também é sanção: avisa só do tipo mais grave que passou do limite.
    const order: MassActionKind[] = ['BAN', 'TOURNAMENT_CANCEL', 'ROLE_CHANGE', 'SANCTION'];
    const kind = order.find((k) => counts[k] >= FRAUD_THRESHOLDS.massActions[k]);
    if (!kind) return;
    const { id, created } = await raiseAlert(db, now, {
      kind: 'MASS_ADMIN_ACTION',
      severity: 'HIGH',
      dedupeKey: `MASS_ADMIN_ACTION:${kind}:${actorId}`,
      userIds: [],
      actorId,
      details: { action: kind, count: counts[kind], windowSeconds: FRAUD_THRESHOLDS.massWindowSeconds, threshold: FRAUD_THRESHOLDS.massActions[kind] },
    });
    if (!created) return;
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { nickname: true } });
    const supers = await db.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: 'SUPER_ADMIN' } }, id: { not: actorId } }, select: { id: true } });
    c.get('log').warn('antifraude: ações administrativas em massa', { alertId: id, actorId, action: kind, count: counts[kind] });
    await notify(
      c,
      supers.map((s) => s.id),
      {
        type: 'SANCTION',
        title: messages.moderation.massAdminActions.title,
        body: messages.moderation.massAdminActions.body(actor?.nickname, counts[kind], MASS_ACTION_LABELS[kind], FRAUD_THRESHOLDS.massWindowSeconds),
        link: '/admin/moderacao?aba=alertas',
      },
    );
  });
}
