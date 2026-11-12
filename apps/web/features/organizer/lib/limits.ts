/**
 * RN-10 — limites do organizador, conferidos ao publicar (não ao criar o rascunho).
 * Função pura: a API simulada usa hoje e a API real reaproveita em B1.
 */
import { ACTIVE_TOURNAMENT_STATUSES, type TournamentStatus } from '@nova/schemas';

export const DEFAULT_MAX_ACTIVE_TOURNAMENTS = 3;
export const VERIFIED_MAX_ACTIVE_TOURNAMENTS = 10;

export interface OrganizerLimits {
  maxActiveTournaments: number;
  /** Lista vazia = todos os jogos ativos. */
  allowedGameIds: string[];
}

export interface OrganizerForLimits {
  isAdmin: boolean;
  verifiedOrganizer: boolean;
  /** Nulo = usa o padrão (3 simultâneos; verificado: 10; todos os jogos). */
  organizerLimits: OrganizerLimits | null;
}

export type LimitCheck = { ok: true } | { ok: false; code: 'ORGANIZER_LIMIT' | 'GAME_NOT_ALLOWED'; message: string };

export function effectiveLimits(organizer: Pick<OrganizerForLimits, 'verifiedOrganizer' | 'organizerLimits'>): OrganizerLimits {
  return organizer.organizerLimits ?? { maxActiveTournaments: organizer.verifiedOrganizer ? VERIFIED_MAX_ACTIVE_TOURNAMENTS : DEFAULT_MAX_ACTIVE_TOURNAMENTS, allowedGameIds: [] };
}

/** Conta os campeonatos "simultâneos" do organizador: de Publicado a Pausado. */
export function countActiveTournaments(tournaments: { ownerId: string; status: TournamentStatus }[], ownerId: string): number {
  return tournaments.filter((t) => t.ownerId === ownerId && ACTIVE_TOURNAMENT_STATUSES.includes(t.status)).length;
}

/** O jogo está liberado para este organizador? */
export function isGameAllowed(organizer: OrganizerForLimits, gameId: string): boolean {
  if (organizer.isAdmin) return true;
  const { allowedGameIds } = effectiveLimits(organizer);
  return allowedGameIds.length === 0 || allowedGameIds.includes(gameId);
}

/**
 * Pode publicar mais um campeonato? `activeCount` é o número de campeonatos simultâneos
 * do dono, sem contar o que está sendo publicado. Admin não tem limite.
 */
export function checkOrganizerLimits(organizer: OrganizerForLimits, input: { activeCount: number; gameId: string; gameName?: string }): LimitCheck {
  if (organizer.isAdmin) return { ok: true };
  const limits = effectiveLimits(organizer);
  if (!isGameAllowed(organizer, input.gameId)) {
    return { ok: false, code: 'GAME_NOT_ALLOWED', message: `Sua conta não está liberada para organizar campeonatos de ${input.gameName ?? 'este jogo'}. Fale com a administração da Nova Arena.` };
  }
  if (input.activeCount >= limits.maxActiveTournaments) {
    const n = limits.maxActiveTournaments;
    return {
      ok: false,
      code: 'ORGANIZER_LIMIT',
      message: `Você já tem ${input.activeCount} ${input.activeCount === 1 ? 'campeonato ativo' : 'campeonatos ativos'} e o seu limite é de ${n} ao mesmo tempo. Finalize ou cancele um deles antes de publicar outro.`,
    };
  }
  return { ok: true };
}
