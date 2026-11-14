/**
 * Módulo `admin-audit` da API simulada (ADM-01 e ADM-08): indicadores do dashboard e consulta da auditoria.
 *
 * A auditoria é somente leitura (RNF-15): aqui só existem rotas `GET`. Quem grava é `audit()`,
 * dentro do handler de cada ação sensível.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { ACTIVE_TOURNAMENT_STATUSES, AUDIT_ACTIONS, auditActionLabel, type AdminStats, type AuditLog, type AuditMeta } from '@nova/schemas';
import { auditLogs, type DbAuditLog } from '../audit';
import { matchId, matchMetas, stageRuns } from '../competition';
import { db } from '../db';
import { findTournament, handle, json, paginateNumbered, param, query, requireTournamentAccess, url } from '../http';
import { findUser } from '../views';
import { openDisputesCount, openReportsCount } from './admin-moderation';
import { reconcileRoleGrants } from './admin-roles';
import { adminOnly } from './admin-settings';
import { expireSuspensions } from './admin-users';
import { disputes } from './submissions';

export const moduleName = 'admin-audit';

const DAY = 24 * 3600_000;
const AUDIT_PAGE_SIZE = 20;
const CSV_MAX_ROWS = 5000;

const actionLabel = auditActionLabel;

const ENTITY_LABELS: Record<string, string> = {
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

function toAuditLog(l: DbAuditLog): AuditLog {
  return {
    id: l.id,
    actorId: l.actorId,
    actorNickname: findUser(l.actorId)?.nickname ?? 'Sistema',
    action: l.action,
    actionLabel: actionLabel(l.action),
    entityType: l.entityType,
    entityId: l.entityId,
    entityLabel: l.entityLabel,
    tournamentId: l.tournamentId,
    before: l.before,
    after: l.after,
    reason: l.reason,
    ip: l.ip,
    createdAt: l.createdAt,
  };
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Início do dia (UTC) para `from` e fim do dia para `to`, quando vêm só como data. */
function boundary(value: string | null, end: boolean): number | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Filtros da consulta, mais recentes primeiro. */
function filteredLogs(q: URLSearchParams): AuditLog[] {
  const actor = normalize((q.get('actor') ?? '').trim());
  const action = q.get('action');
  const entityType = q.get('entityType');
  const entityId = q.get('entityId');
  const tournamentId = q.get('tournamentId');
  const from = boundary(q.get('from'), false);
  const to = boundary(q.get('to'), true);
  return auditLogs()
    .filter((l) => !action || l.action === action)
    .filter((l) => !entityType || l.entityType === entityType)
    .filter((l) => !entityId || l.entityId === entityId)
    .filter((l) => !tournamentId || l.tournamentId === tournamentId)
    .filter((l) => {
      const at = new Date(l.createdAt).getTime();
      return (from === null || at >= from) && (to === null || at <= to);
    })
    .map(toAuditLog)
    .filter((l) => !actor || l.actorId === q.get('actor') || normalize(l.actorNickname).includes(actor))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

// ── CSV ──────────────────────────────────────────────────────────────
/** Aspas e `;` escapados; célula que começa com `=`, `+`, `-` ou `@` ganha apóstrofo (não vira fórmula na planilha). */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditToCsv(logs: AuditLog[]): string {
  const header = ['Data (UTC)', 'Quem', 'Ação', 'Recurso', 'Tipo', 'ID do recurso', 'Campeonato', 'Motivo', 'Antes', 'Depois', 'IP'];
  const rows = logs.map((l) => [l.createdAt, l.actorNickname, l.actionLabel, l.entityLabel, ENTITY_LABELS[l.entityType] ?? l.entityType, l.entityId, l.tournamentId, l.reason, l.before, l.after, l.ip]);
  // BOM + `;`: abre certo no Excel em pt-BR.
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

// ── Dashboard ────────────────────────────────────────────────────────
interface PlayedMatch {
  id: string;
  at: number;
  walkover: boolean;
}

/** Partidas concluídas (resultado valendo), com a data em que o resultado foi lançado. */
function concludedMatches(): PlayedMatch[] {
  const metas = new Map(matchMetas().map((m) => [m.id, m]));
  const out: PlayedMatch[] = [];
  for (const run of stageRuns()) {
    if (!run.confirmed) continue;
    for (const [nodeId, result] of Object.entries(run.state.results)) {
      if (result.voided) continue;
      const id = matchId(run.stageId, nodeId);
      const meta = metas.get(id);
      const when = meta?.updatedAt ?? meta?.scheduledAt ?? run.updatedAt;
      out.push({ id, at: new Date(when).getTime(), walkover: result.walkover });
    }
  }
  return out;
}

/** IDs das partidas de chaves confirmadas com horário marcado entre `from` e `to`. */
function scheduledMatchIds(from: number, to: number): string[] {
  const confirmed = new Set(
    stageRuns()
      .filter((r) => r.confirmed)
      .map((r) => r.stageId),
  );
  return matchMetas()
    .filter((m) => {
      if (!m.scheduledAt || !confirmed.has(m.id.slice(0, m.id.indexOf('~')))) return false;
      const at = new Date(m.scheduledAt).getTime();
      return at >= from && at <= to;
    })
    .map((m) => m.id);
}

const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

function dailySeries(times: number[], from: number, to: number): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of times) if (t >= from && t <= to) counts.set(dayKey(t), (counts.get(dayKey(t)) ?? 0) + 1);
  const out: { date: string; count: number }[] = [];
  for (let t = from; dayKey(t) <= dayKey(to); t += DAY) out.push({ date: dayKey(t), count: counts.get(dayKey(t)) ?? 0 });
  return out;
}

function buildStats(q: URLSearchParams): AdminStats {
  const d = db();
  const now = Date.now();
  const to = Math.min(boundary(q.get('to'), true) ?? now, now);
  // Padrão: últimos 30 dias. Intervalo limitado a um ano.
  const from = Math.max(boundary(q.get('from'), false) ?? to - 29 * DAY, to - 365 * DAY);
  const weekAgo = now - 7 * DAY;

  const people = d.users.filter((u) => u.status !== 'MERGED' && u.status !== 'DELETED');
  const played = concludedMatches();
  const validated = played.filter((m) => !m.walkover);
  const inRange = played.filter((m) => m.at >= from && m.at <= to);
  const disputesInRange = disputes().filter((x) => {
    const at = new Date(x.createdAt).getTime();
    return at >= from && at <= to;
  }).length;

  const byGame = new Map<string, number>();
  for (const t of d.tournaments) {
    if (t.status === 'DRAFT') continue;
    const name = d.games.find((g) => g.id === t.gameId)?.name ?? 'Jogo';
    byGame.set(name, (byGame.get(name) ?? 0) + 1);
  }

  // Partidas da semana: as que tinham horário nos últimos 7 dias ou foram concluídas nesse período.
  const weekMatches = new Set([...scheduledMatchIds(weekAgo, now), ...played.filter((m) => m.at >= weekAgo).map((m) => m.id)]);
  return {
    activeUsers: people.filter((u) => u.status === 'ACTIVE' && new Date(u.lastSeenAt).getTime() >= now - 30 * DAY).length,
    totalUsers: people.length,
    activeTournaments: d.tournaments.filter((t) => ACTIVE_TOURNAMENT_STATUSES.includes(t.status)).length,
    finishedTournaments: d.tournaments.filter((t) => t.status === 'FINISHED' || t.status === 'ARCHIVED').length,
    matchesThisWeek: weekMatches.size,
    validatedMatchesThisWeek: validated.filter((m) => m.at >= weekAgo).length,
    openDisputes: openDisputesCount(),
    openReports: openReportsCount(),
    pendingOrganizerRequests: d.organizerRequests.filter((r) => r.status === 'PENDING').length,
    signups: dailySeries(
      people.map((u) => new Date(u.createdAt).getTime()),
      from,
      to,
    ),
    validatedMatches: dailySeries(
      validated.map((m) => m.at),
      from,
      to,
    ),
    tournamentsByGame: [...byGame.entries()].map(([gameName, count]) => ({ gameName, count })).sort((a, b) => b.count - a.count || a.gameName.localeCompare(b.gameName, 'pt-BR')),
    // Frações entre 0 e 1, sobre as partidas concluídas no período.
    walkoverRate: inRange.length > 0 ? inRange.filter((m) => m.walkover).length / inRange.length : 0,
    disputeRate: inRange.length > 0 ? Math.min(1, disputesInRange / inRange.length) : 0,
  };
}

export const handlers: HttpHandler[] = [
  http.get(
    url('/admin/stats'),
    handle(({ request }) => {
      adminOnly();
      expireSuspensions();
      return json(buildStats(query(request)));
    }),
  ),

  /** Opções dos filtros da tela de auditoria. */
  http.get(
    url('/admin/audit-logs/meta'),
    handle(() => {
      adminOnly();
      const used = new Set(auditLogs().map((l) => l.entityType));
      const meta: AuditMeta = {
        actions: Object.entries(AUDIT_ACTIONS)
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
        entityTypes: [...new Set([...Object.keys(ENTITY_LABELS), ...used])],
      };
      return json(meta);
    }),
  ),

  /** Exportação com os mesmos filtros da consulta. */
  http.get(
    url('/admin/audit-logs.csv'),
    handle(({ request }) => {
      adminOnly();
      reconcileRoleGrants();
      const logs = filteredLogs(query(request)).slice(0, CSV_MAX_ROWS);
      return new HttpResponse(auditToCsv(logs), {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    }),
  ),

  http.get(
    url('/admin/audit-logs'),
    handle(({ request }) => {
      adminOnly();
      reconcileRoleGrants();
      const q = query(request);
      return json(paginateNumbered(filteredLogs(q), q.get('page'), AUDIT_PAGE_SIZE));
    }),
  ),

  /** PRD §6, nota 2: o organizador vê só os logs dos próprios campeonatos (dono, co-organizador ou Admin). */
  http.get(
    url('/tournaments/:id/audit-logs'),
    handle(({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      requireTournamentAccess(t);
      const q = new URLSearchParams(query(request));
      q.set('tournamentId', t.id);
      return json(paginateNumbered(filteredLogs(q), q.get('page'), AUDIT_PAGE_SIZE));
    }),
  ),
];
