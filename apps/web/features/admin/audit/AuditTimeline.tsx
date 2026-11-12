'use client';

import type { AuditLog } from '@nova/schemas';
import { EmptyState, Skeleton } from '@nova/ui';
import { ChevronDown, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { AuditDiff } from './AuditDiff';

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

export function entityTypeLabel(type: string): string {
  return ENTITY_LABELS[type] ?? type;
}

export interface AuditTimelineProps {
  logs: AuditLog[] | undefined;
  loading?: boolean;
  /** Mostrado quando não há registros. */
  empty?: ReactNode;
  /** Versão resumida (dashboard): sem antes/depois e sem IP. */
  compact?: boolean;
  /** Abre o antes/depois de todos os registros (padrão: fechado, abre no clique). */
  expanded?: boolean;
  /** Nome acessível da lista. */
  label?: string;
}

/**
 * Linha do tempo da auditoria: quem fez, o quê, em qual recurso, quando, por quê e o antes/depois.
 * Reutilizável: a tela do Admin passa os logs de `useAuditLogs`; a área do organizador passa os de
 * `useTournamentAuditLogs(tournamentId)`.
 */
export function AuditTimeline({ logs, loading = false, empty, compact = false, expanded = false, label = 'Registros de auditoria' }: AuditTimelineProps) {
  if (loading || !logs) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando registros">
        {Array.from({ length: compact ? 3 : 5 }).map((_, i) => (
          <Skeleton key={i} className={compact ? 'h-12 w-full' : 'h-20 w-full'} />
        ))}
      </div>
    );
  }
  if (logs.length === 0) {
    return <>{empty ?? <EmptyState icon={<ScrollText className="size-7" />} title="Nenhum registro" description="As ações sensíveis aparecem aqui assim que acontecem." />}</>;
  }
  return (
    <ol className="flex flex-col" aria-label={label}>
      {logs.map((log, index) => {
        const hasDiff = Boolean(log.before || log.after);
        return (
          <li key={log.id} data-testid="audit-entry" className="relative flex gap-3 pb-4 last:pb-0">
            <span className="flex flex-col items-center" aria-hidden>
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent" />
              {index < logs.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-sm text-text [overflow-wrap:anywhere]">
                <strong className="font-semibold">{log.actorNickname}</strong> · {log.actionLabel}
              </p>
              <p className="text-sm text-muted [overflow-wrap:anywhere]">
                {entityTypeLabel(log.entityType)}: <span className="text-text">{log.entityLabel}</span>
              </p>
              <p className="text-xs text-muted">
                <time dateTime={log.createdAt} title={formatDateTime(log.createdAt)}>
                  {compact ? formatRelative(log.createdAt) : `${formatDateTime(log.createdAt)} (${formatRelative(log.createdAt)})`}
                </time>
                {!compact && <> · IP {log.ip}</>}
              </p>
              {log.reason && (
                <p className="text-sm text-text [overflow-wrap:anywhere]">
                  <span className="font-medium">Motivo:</span> {log.reason}
                </p>
              )}
              {!compact && hasDiff && (
                <details className="group mt-1" open={expanded}>
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-semibold text-primary-text md:min-h-8 [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                    Antes e depois
                  </summary>
                  <AuditDiff before={log.before} after={log.after} className="mt-1" />
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
