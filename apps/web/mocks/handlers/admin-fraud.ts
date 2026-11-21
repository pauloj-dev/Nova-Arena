/**
 * Módulo `admin-fraud` da API simulada (issue #114): fila de alertas antifraude na moderação.
 *
 * A API real detecta no momento da ação (login, ID de jogo salvo, cada alteração em `/admin/*`). No protótipo a
 * detecção roda ao abrir a fila, sobre os dados simulados:
 * - **ações em massa:** auditoria do último minuto, por Admin (10 banimentos, 15 sanções, 10 papéis, 5 cancelamentos);
 * - **ID de jogo repetido:** o primeiro campo do jogo, normalizado, em mais de uma conta.
 * Os alertas de várias contas por IP/aparelho vêm de exemplo no seed (o protótipo não tem IP nem aparelho).
 */
import {
  FRAUD_ALERT_LABELS,
  FRAUD_THRESHOLDS,
  FraudAlertKind,
  FraudAlertStatus,
  MASS_ACTION_LABELS,
  ReviewFraudAlertInput,
  type FraudAlert,
  type FraudAlertUser,
  type FraudSeverity,
  type MassActionKind,
} from '@nova/schemas';
import { http, type HttpHandler } from 'msw';
import { audit, auditLogs } from '../audit';
import { collection, db, nowIso, save, uid } from '../db';
import { body, conflict, forbidden, handle, json, notFound, param, query, requireAdmin, url } from '../http';
import { notify } from '../notify';
import { findUser } from '../views';
import { DEMO_USERS } from '../seed';

export const moduleName = 'admin-fraud';

export interface DbFraudAlert {
  id: string;
  kind: FraudAlertKind;
  status: FraudAlertStatus;
  severity: FraudSeverity;
  dedupeKey: string;
  userIds: string[];
  actorId: string | null;
  details: FraudAlert['details'];
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  resolution: string | null;
}

const HOUR = 3600_000;

function seedAlerts(): DbFraudAlert[] {
  const now = Date.now();
  const iso = (offset: number) => new Date(now - offset).toISOString();
  const base = { status: 'OPEN' as const, reviewedById: null, reviewedAt: null, resolution: null, actorId: null, occurrences: 1 };
  return [
    {
      ...base,
      id: 'fa_ip_demo',
      kind: 'MULTI_ACCOUNT_IP',
      severity: 'MEDIUM',
      dedupeKey: 'MULTI_ACCOUNT_IP:200.150.10.x',
      userIds: ['u_p11', 'u_p12', 'u_p13', 'u_p14', 'u_p15'],
      details: { ip: '200.150.10.x', accounts: 5, windowHours: FRAUD_THRESHOLDS.ipWindowHours, threshold: FRAUD_THRESHOLDS.ipAccounts },
      firstSeenAt: iso(5 * HOUR),
      lastSeenAt: iso(2 * HOUR),
      occurrences: 3,
    },
    {
      ...base,
      id: 'fa_device_demo',
      kind: 'MULTI_ACCOUNT_DEVICE',
      severity: 'MEDIUM',
      dedupeKey: 'MULTI_ACCOUNT_DEVICE:demo',
      userIds: ['u_p21', 'u_p22', 'u_p23'],
      details: { accounts: 3, windowDays: FRAUD_THRESHOLDS.deviceWindowDays, threshold: FRAUD_THRESHOLDS.deviceAccounts },
      firstSeenAt: iso(26 * HOUR),
      lastSeenAt: iso(20 * HOUR),
    },
  ];
}

export const fraudAlerts = () => collection<DbFraudAlert>('fraudAlerts', seedAlerts);

function raise(input: Omit<DbFraudAlert, 'id' | 'status' | 'occurrences' | 'firstSeenAt' | 'lastSeenAt' | 'reviewedById' | 'reviewedAt' | 'resolution'>): { alert: DbFraudAlert; created: boolean } {
  const since = Date.now() - FRAUD_THRESHOLDS.dedupeHours * HOUR;
  const open = fraudAlerts().find((a) => a.dedupeKey === input.dedupeKey && a.status === 'OPEN' && Date.parse(a.lastSeenAt) >= since);
  if (open) {
    // Mesma situação de antes: só atualiza os números (sem somar ocorrência a cada leitura da fila).
    const changed = JSON.stringify(open.details) !== JSON.stringify(input.details);
    open.details = input.details;
    open.userIds = [...new Set([...open.userIds, ...input.userIds])];
    if (changed) {
      open.occurrences += 1;
      open.lastSeenAt = nowIso();
    }
    return { alert: open, created: false };
  }
  const alert: DbFraudAlert = { ...input, id: uid('fa'), status: 'OPEN', occurrences: 1, firstSeenAt: nowIso(), lastSeenAt: nowIso(), reviewedById: null, reviewedAt: null, resolution: null };
  fraudAlerts().push(alert);
  return { alert, created: true };
}

/** Ações em massa: a auditoria do último minuto, por Admin. */
function detectMassActions(): void {
  const since = Date.now() - FRAUD_THRESHOLDS.massWindowSeconds * 1000;
  const byActor = new Map<string, Record<MassActionKind, number>>();
  for (const log of auditLogs()) {
    if (!log.actorId || Date.parse(log.createdAt) < since) continue;
    const counts = byActor.get(log.actorId) ?? { BAN: 0, SANCTION: 0, ROLE_CHANGE: 0, TOURNAMENT_CANCEL: 0 };
    if (log.action === 'USER_SANCTIONED') {
      counts.SANCTION += 1;
      if (log.after?.sancao === 'BAN') counts.BAN += 1;
    }
    if (log.action === 'ROLE_GRANTED' || log.action === 'ROLE_REVOKED') counts.ROLE_CHANGE += 1;
    if (log.action === 'TOURNAMENT_STATUS_CHANGED' && log.after?.status === 'CANCELLED') counts.TOURNAMENT_CANCEL += 1;
    byActor.set(log.actorId, counts);
  }
  for (const [actorId, counts] of byActor) {
    const kind = (['BAN', 'TOURNAMENT_CANCEL', 'ROLE_CHANGE', 'SANCTION'] as const).find((k) => counts[k] >= FRAUD_THRESHOLDS.massActions[k]);
    if (!kind) continue;
    const { created } = raise({
      kind: 'MASS_ADMIN_ACTION',
      severity: 'HIGH',
      dedupeKey: `MASS_ADMIN_ACTION:${kind}:${actorId}`,
      userIds: [],
      actorId,
      details: { action: kind, count: counts[kind], windowSeconds: FRAUD_THRESHOLDS.massWindowSeconds, threshold: FRAUD_THRESHOLDS.massActions[kind] },
    });
    if (created) {
      const supers = db()
        .users.filter((u) => u.status === 'ACTIVE' && u.roles.includes('SUPER_ADMIN') && u.id !== actorId)
        .map((u) => u.id);
      notify(supers, 'SANCTION', 'Alerta: ações administrativas em massa', `${findUser(actorId)?.nickname ?? 'Um Admin'} fez ${counts[kind]} ${MASS_ACTION_LABELS[kind]} em ${FRAUD_THRESHOLDS.massWindowSeconds} s. Confira na moderação.`, '/admin/moderacao?aba=alertas');
    }
  }
}

/** ID de jogo repetido: o primeiro campo do jogo, sem espaços e em minúsculas. */
function detectDuplicateGameIds(): void {
  const games = new Map(db().games.map((g) => [g.id, g]));
  const seen = new Map<string, string[]>();
  for (const user of db().users) {
    if (user.status === 'DELETED' || user.status === 'MERGED') continue;
    for (const account of user.gameAccounts) {
      const firstKey = games.get(account.gameId)?.requiredAccountFields[0]?.key;
      const value = (firstKey ? account.fields[firstKey] : undefined)?.replace(/\s+/g, '').toLowerCase();
      if (!value) continue;
      const key = `${account.gameId}:${value}`;
      seen.set(key, [...(seen.get(key) ?? []), user.id]);
    }
  }
  for (const [key, userIds] of seen) {
    if (userIds.length < 2) continue;
    const [gameId, playerId] = key.split(':') as [string, string];
    raise({ kind: 'DUPLICATE_GAME_ID', severity: 'HIGH', dedupeKey: `DUPLICATE_GAME_ID:${key}`, userIds, actorId: null, details: { game: games.get(gameId)?.name ?? 'jogo', gameId, playerId, accounts: userIds.length } });
  }
}

function toUser(id: string): FraudAlertUser | null {
  const u = findUser(id);
  return u ? { id: u.id, nickname: u.nickname, status: u.status } : null;
}

function summaryOf(a: DbFraudAlert, actor: FraudAlertUser | null): string {
  const n = (key: string) => (typeof a.details[key] === 'number' ? (a.details[key] as number) : 0);
  switch (a.kind) {
    case 'MULTI_ACCOUNT_IP':
      return `${n('accounts')} contas entraram do IP ${String(a.details.ip ?? '')} em ${n('windowHours')} h.`;
    case 'MULTI_ACCOUNT_DEVICE':
      return `${n('accounts')} contas entraram do mesmo aparelho em ${n('windowDays')} dias.`;
    case 'DUPLICATE_GAME_ID':
      return `O ID "${String(a.details.playerId ?? '')}" do ${String(a.details.game ?? 'jogo')} está em ${n('accounts')} contas.`;
    case 'MASS_ADMIN_ACTION': {
      const action = a.details.action as MassActionKind;
      return `${actor?.nickname ?? 'Um Admin'} fez ${n('count')} ${MASS_ACTION_LABELS[action] ?? 'ações'} em ${n('windowSeconds')} s.`;
    }
  }
}

function toAlert(a: DbFraudAlert): FraudAlert {
  const actor = a.actorId ? toUser(a.actorId) : null;
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    severity: a.severity,
    summary: summaryOf(a, actor),
    users: a.userIds.map(toUser).filter((u): u is FraudAlertUser => u !== null),
    actor,
    details: a.details,
    occurrences: a.occurrences,
    firstSeenAt: a.firstSeenAt,
    lastSeenAt: a.lastSeenAt,
    reviewedByNickname: a.reviewedById ? (findUser(a.reviewedById)?.nickname ?? null) : null,
    reviewedAt: a.reviewedAt,
    resolution: a.resolution,
  };
}

const visible = (isSuper: boolean) => (a: DbFraudAlert) => isSuper || a.kind !== 'MASS_ADMIN_ACTION';

export const handlers: HttpHandler[] = [
  http.get(
    url('/admin/fraud-alerts'),
    handle(({ request }) => {
      const actor = requireAdmin();
      detectMassActions();
      detectDuplicateGameIds();
      save();
      const q = query(request);
      const status = FraudAlertStatus.safeParse(q.get('status'));
      const kind = FraudAlertKind.safeParse(q.get('kind'));
      const scoped = fraudAlerts().filter(visible(actor.roles.includes('SUPER_ADMIN')));
      const rows = scoped
        .filter((a) => (!status.success || a.status === status.data) && (!kind.success || a.kind === kind.data))
        .sort((a, b) => Number(a.status !== 'OPEN') - Number(b.status !== 'OPEN') || b.lastSeenAt.localeCompare(a.lastSeenAt));
      const size = 20;
      const pageCount = Math.max(1, Math.ceil(rows.length / size));
      const page = Math.min(Math.max(1, Number.parseInt(q.get('page') ?? '1', 10) || 1), pageCount);
      return json({ items: rows.slice((page - 1) * size, page * size).map(toAlert), page, pageCount, total: rows.length, openCount: scoped.filter((a) => a.status === 'OPEN').length });
    }),
  ),

  http.patch(
    url('/admin/fraud-alerts/:id'),
    handle(async ({ request, params }) => {
      const actor = requireAdmin();
      const alert = fraudAlerts()
        .filter(visible(actor.roles.includes('SUPER_ADMIN')))
        .find((a) => a.id === param(params, 'id'));
      if (!alert) throw notFound('Alerta');
      if (alert.actorId === actor.id) throw forbidden('Outro Super Admin precisa analisar um alerta sobre as suas próprias ações.');
      if (alert.status !== 'OPEN') throw conflict('Este alerta já foi analisado.', 'ALERT_CLOSED');
      const input = await body(request, ReviewFraudAlertInput);
      alert.status = input.status;
      alert.resolution = input.resolution;
      alert.reviewedById = actor.id;
      alert.reviewedAt = nowIso();
      save();
      audit(actor, { action: 'FRAUD_ALERT_REVIEWED', entityType: 'FraudAlert', entityId: alert.id, entityLabel: FRAUD_ALERT_LABELS[alert.kind], before: { status: 'OPEN' }, after: { status: alert.status }, reason: input.resolution });
      return json(toAlert(alert));
    }),
  ),
];

/** Só para testes: o Super Admin de demonstração (quem recebe o aviso das ações em massa). */
export const FRAUD_SUPER_ADMIN = DEMO_USERS.superAdmin;
