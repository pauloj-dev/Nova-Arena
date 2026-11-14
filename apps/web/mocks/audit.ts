/**
 * Auditoria da API simulada. Só existe inserção (append-only), como na API real (RNF-15).
 * Toda ação sensível chama `audit()` dentro do handler, junto com a mutação.
 */
import { AUDIT_ACTIONS, type AuditAction } from '@nova/schemas';
import { collection, nowIso, save, uid, type DbUser } from './db';

export interface DbAuditLog {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  tournamentId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string;
  createdAt: string;
}

/** Catálogo único das ações auditadas: vem de `@nova/schemas` (usado também pela API real e nos filtros). */
export { AUDIT_ACTIONS };

export const auditLogs = () => collection<DbAuditLog>('auditLogs');

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityLabel: string;
  tournamentId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

export function audit(actor: DbUser | null, input: AuditInput): DbAuditLog {
  const entry: DbAuditLog = {
    id: uid('al'),
    actorId: actor?.id ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    tournamentId: input.tournamentId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    ip: '203.0.113.10',
    createdAt: nowIso(),
  };
  auditLogs().push(entry);
  save();
  return entry;
}
