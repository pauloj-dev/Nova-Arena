/**
 * Auditoria da API simulada. Só existe inserção (append-only), como na API real (RNF-15).
 * Toda ação sensível chama `audit()` dentro do handler, junto com a mutação.
 */
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

/** Catálogo único das ações auditadas (usado nos filtros da tela de auditoria). */
export const AUDIT_ACTIONS: Record<string, string> = {
  INVITE_CREATED: 'Convite criado',
  INVITE_REVOKED: 'Convite revogado',
  INVITE_ACCEPTED: 'Convite aceito',
  ROLE_GRANTED: 'Papel concedido',
  ROLE_REVOKED: 'Papel revogado',
  ORGANIZER_REQUEST_REVIEWED: 'Pedido de organizador analisado',
  ORGANIZER_LIMITS_CHANGED: 'Limites do organizador alterados',
  USER_SANCTIONED: 'Usuário sancionado',
  SANCTION_LIFTED: 'Sanção removida',
  USER_PASSWORD_RESET: 'Senha redefinida pelo Admin',
  USERS_MERGED: 'Contas mescladas',
  GAME_CREATED: 'Jogo criado',
  GAME_UPDATED: 'Jogo alterado',
  SCORING_MODEL_CHANGED: 'Modelo de pontuação alterado',
  TOURNAMENT_PUBLISHED: 'Campeonato publicado',
  TOURNAMENT_UPDATED: 'Campeonato alterado',
  TOURNAMENT_STATUS_CHANGED: 'Status do campeonato alterado',
  TOURNAMENT_OWNER_CHANGED: 'Responsável do campeonato trocado',
  TOURNAMENT_FEATURED: 'Destaque na home alterado',
  STAFF_CHANGED: 'Equipe do evento alterada',
  BRACKET_GENERATED: 'Chave gerada',
  BRACKET_CONFIRMED: 'Chave confirmada',
  BRACKET_SEEDING_CHANGED: 'Chave ajustada manualmente',
  BRACKET_UNLOCKED: 'Chave destravada',
  STAGE_ADVANCED: 'Fase avançada',
  STAGE_SCORING_CHANGED: 'Pontuação da fase alterada',
  MATCH_SCHEDULED: 'Partida agendada',
  RESULT_ENTERED: 'Resultado lançado',
  RESULT_CORRECTED: 'Resultado corrigido',
  WALKOVER_APPLIED: 'W.O. aplicado',
  REGISTRATION_REVIEWED: 'Inscrição analisada',
  ENTRANT_WITHDRAWN: 'Desistência registrada',
  ENTRANT_DISQUALIFIED: 'Participante desclassificado',
  DISPUTE_RESOLVED: 'Disputa resolvida',
  DISPUTE_ESCALATED: 'Disputa escalada para a administração',
  SUBMISSION_REJECTED: 'Resultado enviado recusado',
  REPORT_HANDLED: 'Denúncia tratada',
  SETTINGS_CHANGED: 'Configurações alteradas',
  FLAG_CHANGED: 'Recurso ligado ou desligado',
  ANNOUNCEMENT_SENT: 'Comunicado enviado',
  ANNOUNCEMENT_DELETED: 'Comunicado apagado',
  ANNOUNCEMENT_TOGGLED: 'Comunicado ativado ou desativado',
  ADMIN_REMOVAL_REQUESTED: 'Remoção de administrador solicitada',
  ADMIN_REMOVAL_REVIEWED: 'Remoção de administrador analisada',
  TWO_FACTOR_CHANGED: 'Verificação em duas etapas alterada',
};

export const auditLogs = () => collection<DbAuditLog>('auditLogs');

export interface AuditInput {
  action: keyof typeof AUDIT_ACTIONS | (string & {});
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
