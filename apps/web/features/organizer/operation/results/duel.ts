/**
 * Regras do lançamento de duelo (`ScoreInput`), como funções puras: rótulo do placar conforme o jogo,
 * validação da série MD, quando o desempate aparece (RN-14) e o corpo do envio.
 */
import type { ExtraStatField, Match, ResultEntryInput } from '@nova/schemas';

export interface DuelSide {
  registrationId: string;
  name: string;
  score: string;
  /** Estatísticas extras do jogo (ex.: pênaltis): chave → texto digitado. */
  stats: Record<string, string>;
}

export interface DuelState {
  sides: [DuelSide, DuelSide];
  /** Vencedor escolhido à mão, quando o placar (e o desempate) não decidem. */
  winnerRegistrationId: string | null;
}

export interface DuelContext {
  bestOf: number;
  /** Partida eliminatória (chave): não pode terminar empatada. */
  elimination: boolean;
  extraStatFields: ExtraStatField[];
}

export interface DuelValidation {
  errors: { scores: Record<string, string>; stats: Record<string, string>; winner?: string; form?: string };
  missing: boolean;
  valid: boolean;
  /** Placar empatado em jogo único. */
  tied: boolean;
  /** Mostrar os campos de desempate do jogo (`when: 'tiebreak'`). */
  showTiebreak: boolean;
  /** Pedir a escolha explícita do vencedor. */
  needsWinner: boolean;
  /** Vencedor que o formulário indica (placar, desempate ou escolha), ou nulo. */
  winnerId: string | null;
  draw: boolean;
}

/** Rótulo do placar conforme o jogo: coroas, gols, frames; em série MD, jogos vencidos. */
export function scoreLabel(gameSlug: string | undefined, bestOf: number): string {
  if (bestOf > 1) return 'Jogos vencidos';
  switch (gameSlug) {
    case 'clash-royale':
      return 'Coroas';
    case 'efootball':
      return 'Gols';
    case '8-ball-pool':
      return 'Frames';
    default:
      return 'Placar';
  }
}

export const winsNeeded = (bestOf: number) => Math.ceil(bestOf / 2);

function count(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  return /^-?\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
}

export function duelFromMatch(match: Match): DuelState | null {
  const [a, b] = match.participants;
  if (match.kind !== 'DUEL' || !a?.registrationId || !b?.registrationId) return null;
  const side = (p: typeof a): DuelSide => ({
    registrationId: p.registrationId as string,
    name: p.name,
    score: p.score === null || match.walkover ? '' : String(p.score),
    stats: Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, String(v)])),
  });
  return { sides: [side(a), side(b)], winnerRegistrationId: null };
}

export function validateDuel(state: DuelState, ctx: DuelContext): DuelValidation {
  const [a, b] = state.sides;
  const errors: DuelValidation['errors'] = { scores: {}, stats: {} };
  const sa = count(a.score);
  const sb = count(b.score);
  let missing = false;
  for (const [side, value] of [[a, sa], [b, sb]] as const) {
    if (value === null) missing = true;
    else if (!Number.isFinite(value)) errors.scores[side.registrationId] = 'Use um número inteiro';
    else if (value < 0) errors.scores[side.registrationId] = 'O placar não pode ser negativo';
    else if (value > 999) errors.scores[side.registrationId] = 'O máximo é 999';
  }
  const scoresOk = sa !== null && sb !== null && Object.keys(errors.scores).length === 0;
  const series = ctx.bestOf > 1;
  const needed = winsNeeded(ctx.bestOf);
  const tied = scoresOk && !series && sa === sb;

  if (scoresOk && series) {
    const max = Math.max(sa, sb);
    const min = Math.min(sa, sb);
    if (max > needed || min >= needed) errors.form = `Em uma série melhor de ${ctx.bestOf}, quem vence faz exatamente ${needed} ${needed === 1 ? 'vitória' : 'vitórias'} e o outro lado fica abaixo disso.`;
    else if (max < needed) errors.form = `Ninguém chegou a ${needed} ${needed === 1 ? 'vitória' : 'vitórias'} ainda: a série melhor de ${ctx.bestOf} não terminou.`;
  }

  // Estatísticas extras: as "always" sempre; as de desempate só no empate de jogo eliminatório (RN-14).
  const tiebreakFields = ctx.extraStatFields.filter((f) => f.when === 'tiebreak');
  const showTiebreak = tied && ctx.elimination && tiebreakFields.length > 0;
  const visible = ctx.extraStatFields.filter((f) => f.when === 'always' || showTiebreak);
  for (const field of visible) {
    for (const side of state.sides) {
      const value = count(side.stats[field.key] ?? '');
      const key = `${side.registrationId}:${field.key}`;
      if (value === null) {
        if (field.when === 'tiebreak') missing = true;
      } else if (!Number.isFinite(value) || value < 0) errors.stats[key] = 'Use um número inteiro a partir de 0';
    }
  }

  let winnerId: string | null = null;
  let needsWinner = false;
  if (scoresOk && !errors.form) {
    if (sa > sb) winnerId = a.registrationId;
    else if (sb > sa) winnerId = b.registrationId;
    else if (ctx.elimination) {
      // Empate em jogo eliminatório: decide o desempate do jogo; se ele também empatar (ou não existir), a organização escolhe.
      let decided = false;
      for (const field of tiebreakFields) {
        const va = count(a.stats[field.key] ?? '');
        const vb = count(b.stats[field.key] ?? '');
        if (va !== null && vb !== null && Number.isFinite(va) && Number.isFinite(vb) && va !== vb) {
          winnerId = va > vb ? a.registrationId : b.registrationId;
          decided = true;
          break;
        }
      }
      if (!decided) {
        const filled = tiebreakFields.every((f) => state.sides.every((s) => count(s.stats[f.key] ?? '') !== null));
        needsWinner = tiebreakFields.length === 0 || filled;
        if (needsWinner) {
          if (state.winnerRegistrationId === a.registrationId || state.winnerRegistrationId === b.registrationId) winnerId = state.winnerRegistrationId;
          else errors.winner = 'O placar ficou empatado: escolha quem venceu o desempate';
        }
      }
    }
  }
  const draw = scoresOk && !errors.form && winnerId === null && !ctx.elimination && tied;
  const hasErrors = Object.keys(errors.scores).length > 0 || Object.keys(errors.stats).length > 0 || Boolean(errors.form) || Boolean(errors.winner);
  return { errors, missing, valid: !missing && !hasErrors, tied, showTiebreak, needsWinner, winnerId, draw };
}

/** Corpo do envio. Chamar apenas com o formulário válido. */
export function duelPayload(state: DuelState, ctx: DuelContext, validation: DuelValidation): { entries: ResultEntryInput[]; winnerRegistrationId?: string | null } {
  const visible = ctx.extraStatFields.filter((f) => f.when === 'always' || validation.showTiebreak);
  const entries = state.sides.map((side): ResultEntryInput => {
    const stats: Record<string, number> = {};
    for (const field of visible) {
      const value = count(side.stats[field.key] ?? '');
      if (value !== null && Number.isFinite(value)) stats[field.key] = value;
    }
    return { registrationId: side.registrationId, score: count(side.score) ?? 0, ...(Object.keys(stats).length > 0 ? { stats } : {}) };
  });
  // O vencedor só vai explícito quando foi escolhido à mão; no resto o servidor deduz do placar e do desempate.
  return validation.needsWinner && validation.winnerId ? { entries, winnerRegistrationId: validation.winnerId } : { entries };
}
