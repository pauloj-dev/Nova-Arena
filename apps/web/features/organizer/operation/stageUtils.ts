/** Leitura das fases e da chave para as telas de operação (funções puras). */
import type { Bracket, Match, Stage, TournamentAccessRole } from '@nova/schemas';

export const byOrder = (stages: readonly Stage[]): Stage[] => [...stages].sort((a, b) => a.order - b.order);

/** A fase em que o campeonato está: a primeira que ainda não foi concluída (ou a última, se todas foram). */
export function currentStage(stages: readonly Stage[]): Stage | undefined {
  const ordered = byOrder(stages);
  return ordered.find((s) => s.status !== 'COMPLETED') ?? ordered.at(-1);
}

export const STAGE_STATUS_LABEL: Record<Stage['status'], string> = { PENDING: 'Pendente', ACTIVE: 'Em andamento', COMPLETED: 'Concluída' };

const isOver = (m: Match) => m.status === 'VALIDATED' || m.status === 'WALKOVER' || m.status === 'CANCELLED';

/** Partidas que ainda precisam de resultado (as "se necessário" que ainda esperam participantes não contam). */
export function pendingMatches(matches: readonly Match[]): Match[] {
  return matches.filter((m) => !isOver(m) && !(m.ifNecessary && m.waitingPrevious));
}

export function playedCount(matches: readonly Match[]): number {
  return matches.filter((m) => m.status === 'VALIDATED' || m.status === 'WALKOVER').length;
}

/** Suíço: a rodada atual terminou e ainda há rodada para gerar. */
export function canGenerateNextSwissRound(bracket: Bracket, totalRounds: number): boolean {
  if (bracket.format !== 'SWISS' || bracket.state !== 'CONFIRMED' || bracket.matches.length === 0) return false;
  const current = Math.max(...bracket.matches.map((m) => m.round));
  return current < totalRounds && bracket.matches.filter((m) => m.round === current).every(isOver);
}

export interface SeedingSlot {
  registrationId: string;
  name: string;
  tag: string | null;
  seed: number | null;
}
export interface SeedingContainer {
  id: string;
  label: string;
  slots: SeedingSlot[];
}

/**
 * Onde cada participante está na chave, para o ajuste manual: grupos e salas quando existem;
 * confrontos iniciais no mata-mata (quem tem bye aparece na partida em que entra); senão, a
 * lista na ordem das seeds.
 */
export function seedingContainers(bracket: Bracket): SeedingContainer[] {
  const entrant = new Map(bracket.entrants.map((e) => [e.registrationId, e]));
  const slot = (registrationId: string): SeedingSlot => {
    const e = entrant.get(registrationId);
    return { registrationId, name: e?.name ?? 'Inscrito', tag: e?.tag ?? null, seed: e?.seed ?? null };
  };
  if (bracket.groups.length > 0) return bracket.groups.map((g) => ({ id: g.id, label: g.name, slots: g.registrationIds.map(slot) }));

  const duels = bracket.matches.filter((m) => m.kind === 'DUEL' && m.participants.some((p) => p.registrationId !== null));
  const elimination = bracket.format === 'SINGLE_ELIM' || bracket.format === 'DOUBLE_ELIM' || bracket.format === 'TEAM_VS_TEAM';
  if (elimination && duels.length > 0) {
    const seen = new Set<string>();
    const containers: SeedingContainer[] = [];
    for (const m of [...duels].sort((a, b) => a.round - b.round || a.position - b.position)) {
      const slots = m.participants.filter((p) => p.registrationId !== null && !seen.has(p.registrationId)).map((p) => slot(p.registrationId as string));
      if (slots.length === 0) continue;
      slots.forEach((s) => seen.add(s.registrationId));
      const sameRound = duels.filter((x) => x.round === m.round && x.bracket === m.bracket).length;
      containers.push({ id: m.id, label: `${m.roundLabel}${sameRound > 1 ? ` · jogo ${m.position}` : ''}${m.participants.some((p) => p.isBye) ? ' (entra direto, com bye)' : ''}`, slots });
    }
    if (containers.length > 0) return containers;
  }
  return [{ id: 'todos', label: 'Participantes, na ordem das seeds', slots: [...bracket.entrants].sort((a, b) => a.seed - b.seed).map((e) => slot(e.registrationId)) }];
}

// ── Permissões na tela (a API confere de novo — PRD §6) ──────────────
export interface OperationPermissions {
  /** Dono, co-organizador ou Admin: gera chave, avança fase, comunica, pausa, desclassifica. */
  canManage: boolean;
  /** Dono ou Admin: monta a equipe do evento, cancela. */
  isOwner: boolean;
  isAdmin: boolean;
  /** Moderador: só agenda, lança/valida resultados e aprova/recusa inscrições. */
  isModerator: boolean;
}

export function permissionsOf(access: TournamentAccessRole): OperationPermissions {
  return { canManage: access !== 'MODERATOR', isOwner: access === 'OWNER' || access === 'ADMIN', isAdmin: access === 'ADMIN', isModerator: access === 'MODERATOR' };
}

// ── Desistência e desclassificação (RN-06) ───────────────────────────
/** O que acontece com o participante na fase em andamento, conforme o formato. */
export function withdrawEffect(stage: Pick<Stage, 'format' | 'config'> | undefined, kind: 'WITHDRAWN' | 'DISQUALIFIED'): string {
  if (!stage) return 'Não há fase em andamento: a inscrição sai do campeonato e a vaga não é reposta.';
  const lobby = stage.format === 'BATTLE_ROYALE' || (stage.format === 'GROUPS' && stage.config.groupMode === 'BATTLE_ROYALE');
  if (lobby) return kind === 'DISQUALIFIED' ? 'Os pontos são zerados e a tabela é reordenada. Ele sai das quedas futuras.' : 'Ele sai das quedas futuras. Os pontos já feitos ficam na tabela.';
  switch (stage.format) {
    case 'SINGLE_ELIM':
    case 'DOUBLE_ELIM':
    case 'TEAM_VS_TEAM':
      return 'A partida atual e as futuras viram W.O. para o adversário. Os resultados que já aconteceram ficam.';
    case 'SWISS':
      return kind === 'DISQUALIFIED' ? 'Ele sai dos próximos pareamentos e os pontos são zerados.' : 'Ele sai dos próximos pareamentos. Os resultados que já aconteceram ficam.';
    default:
      return kind === 'DISQUALIFIED'
        ? 'Todos os resultados dele são anulados e ele sai da tabela.'
        : 'Se ele jogou menos da metade das partidas, os resultados dele são anulados; se jogou metade ou mais, as partidas restantes viram W.O. para os adversários.';
  }
}
