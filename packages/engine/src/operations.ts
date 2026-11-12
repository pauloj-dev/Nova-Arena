import { EngineError } from './errors';
import type {
  EntrantStatus,
  MatchNode,
  MatchResult,
  MatchResultInput,
  MatchStatus,
  ResultEntry,
  StageSnapshot,
  StageState,
  StageStructure,
} from './types';

const ELIMINATION_FORMATS: ReadonlySet<string> = new Set(['SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM']);

/** Formatos em que perder (uma ou duas vezes) tira o participante da fase. */
export function isEliminationFormat(format: string): boolean {
  return ELIMINATION_FORMATS.has(format);
}

/** Estado inicial de uma fase: nenhum resultado, ninguém fora. */
export function createStageState(): StageState {
  return { results: {}, entrantStatus: {}, skipped: [] };
}

function findMatch(structure: StageStructure, matchId: string): MatchNode {
  const match = structure.matches.find((m) => m.id === matchId);
  if (!match) throw new EngineError('MATCH_NOT_FOUND', `Partida ${matchId} não encontrada.`);
  return match;
}

const invalidResult = (message: string): EngineError => new EngineError('INVALID_RESULT', message);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Situação de uma partida para a tela. */
export function getMatchStatus(structure: StageStructure, state: StageState, matchId: string): MatchStatus {
  const match = findMatch(structure, matchId);
  if (state.skipped.includes(matchId)) return 'SKIPPED';
  if (match.kind === 'DUEL' && match.slots.length === 1) return 'BYE';
  const result = state.results[matchId];
  if (result) return result.voided ? 'VOIDED' : 'COMPLETED';
  return match.slots.every((slot) => slot.entrantId !== null) ? 'READY' : 'PENDING';
}

/** Todas as partidas da fase têm resultado (no suíço: todas as rodadas já geradas e concluídas). */
export function isStageComplete(structure: StageStructure, state: StageState): boolean {
  if (structure.format === 'SWISS') {
    const current = structure.matches.reduce((max, match) => Math.max(max, match.round), 0);
    if (current < structure.rounds) return false;
  }
  return structure.matches.every(
    (match) =>
      (match.kind === 'DUEL' && match.slots.length === 1) || state.results[match.id] !== undefined || state.skipped.includes(match.id),
  );
}

function ensureEditable(structure: StageStructure, state: StageState, match: MatchNode): void {
  if (!state.results[match.id]) return;
  const locked = new EngineError(
    'RESULT_LOCKED',
    'Este resultado não pode mais ser alterado porque uma partida seguinte já foi concluída.',
  );
  for (const nextId of [match.nextMatchId, match.loserNextMatchId]) {
    if (nextId !== null && state.results[nextId]) throw locked;
  }
  if (structure.format === 'SWISS' && structure.matches.some((m) => m.round > match.round)) throw locked;
}

function duelResult(structure: StageStructure, state: StageState, match: MatchNode, input: MatchResultInput): MatchResult {
  const a = match.slots[0]?.entrantId ?? null;
  const b = match.slots[1]?.entrantId ?? null;
  if (match.slots.length !== 2 || a === null || b === null) {
    throw new EngineError('MATCH_NOT_READY', 'Esta partida ainda não tem os dois participantes definidos.');
  }
  if (state.skipped.includes(match.id)) throw invalidResult('Esta partida não será jogada.');
  ensureEditable(structure, state, match);

  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (entry.entrantId !== a && entry.entrantId !== b) throw invalidResult('O resultado cita um participante que não está na partida.');
    if (seen.has(entry.entrantId)) throw invalidResult('O resultado repete um participante.');
    seen.add(entry.entrantId);
    if (entry.score !== undefined && !isCount(entry.score)) throw invalidResult('O placar precisa ser um número a partir de 0.');
  }
  const entryA = input.entries.find((entry) => entry.entrantId === a);
  const entryB = input.entries.find((entry) => entry.entrantId === b);
  const scoreA = entryA?.score;
  const scoreB = entryB?.score;

  let winnerId: string | null;
  if (input.winnerId !== undefined) {
    if (input.winnerId !== null && input.winnerId !== a && input.winnerId !== b) {
      throw invalidResult('O vencedor informado não está na partida.');
    }
    winnerId = input.winnerId;
  } else if (scoreA === undefined || scoreB === undefined) {
    throw invalidResult('Informe o placar dos dois lados ou o vencedor.');
  } else {
    winnerId = scoreA > scoreB ? a : scoreB > scoreA ? b : null;
  }
  const loserId = winnerId === null ? null : winnerId === a ? b : a;
  const walkover = input.walkover ?? false;

  if (winnerId === null) {
    if (match.bracket !== null) {
      throw new EngineError('DRAW_NOT_ALLOWED', 'Partida eliminatória não pode terminar empatada: informe o vencedor do desempate.');
    }
    if (match.bestOf > 1) {
      throw new EngineError('DRAW_NOT_ALLOWED', `Uma série melhor de ${match.bestOf} não termina empatada.`);
    }
    if (scoreA !== scoreB) throw invalidResult('O placar não bate com o empate informado.');
  } else if (scoreA !== undefined && scoreB !== undefined) {
    const winnerScore = winnerId === a ? scoreA : scoreB;
    const loserScore = winnerId === a ? scoreB : scoreA;
    if (winnerScore < loserScore) throw invalidResult('O vencedor informado tem placar menor que o adversário.');
    if (match.bestOf > 1 && !walkover) {
      const needed = Math.ceil(match.bestOf / 2);
      if (winnerScore !== needed || loserScore >= needed) {
        throw invalidResult(`Em uma série melhor de ${match.bestOf}, o vencedor precisa de exatamente ${needed} vitórias.`);
      }
    }
  }

  const normalize = (id: string, entry: ResultEntry | undefined): ResultEntry => {
    const out: ResultEntry = { entrantId: id };
    if (entry?.score !== undefined) out.score = entry.score;
    if (entry?.stats !== undefined) out.stats = entry.stats;
    return out;
  };
  return {
    matchId: match.id,
    entries: [normalize(a, entryA), normalize(b, entryB)],
    winnerId,
    loserId,
    draw: winnerId === null,
    walkover,
    voided: false,
  };
}

function lobbyResult(state: StageState, match: MatchNode, input: MatchResultInput): MatchResult {
  const inLobby = new Set(match.slots.map((slot) => slot.entrantId));
  const seen = new Set<string>();
  const placements = new Set<number>();
  const entries: ResultEntry[] = [];
  for (const entry of input.entries) {
    if (!inLobby.has(entry.entrantId)) throw invalidResult('O resultado cita uma equipe que não está nesta sala.');
    if (seen.has(entry.entrantId)) throw invalidResult('O resultado repete uma equipe.');
    seen.add(entry.entrantId);
    if (entry.absent) {
      entries.push({ entrantId: entry.entrantId, absent: true, kills: 0 });
      continue;
    }
    const { placement } = entry;
    if (placement === undefined || !Number.isInteger(placement) || placement < 1 || placement > match.slots.length) {
      throw invalidResult(`A colocação precisa ser um número inteiro de 1 a ${match.slots.length}.`);
    }
    if (placements.has(placement)) throw invalidResult(`Duas equipes estão com a colocação ${placement}.`);
    placements.add(placement);
    const kills = entry.kills ?? 0;
    if (!isCount(kills) || !Number.isInteger(kills)) throw invalidResult('As kills precisam ser um número inteiro a partir de 0.');
    const out: ResultEntry = { entrantId: entry.entrantId, placement, kills };
    if (entry.stats !== undefined) out.stats = entry.stats;
    entries.push(out);
  }
  for (const slot of match.slots) {
    const id = slot.entrantId as string;
    if (!seen.has(id) && state.entrantStatus[id] === undefined) {
      throw invalidResult('Faltou lançar o resultado de uma ou mais equipes da sala.');
    }
  }
  const winner = entries.find((entry) => entry.placement === 1);
  return {
    matchId: match.id,
    entries,
    winnerId: winner?.entrantId ?? null,
    loserId: null,
    draw: false,
    walkover: input.walkover ?? false,
    voided: false,
  };
}

function applyCore(snapshot: StageSnapshot, input: MatchResultInput): StageSnapshot {
  const { structure, state } = snapshot;
  const match = findMatch(structure, input.matchId);
  if (!Array.isArray(input.entries)) throw invalidResult('Informe o resultado dos participantes.');

  if (match.kind === 'LOBBY') {
    const result = lobbyResult(state, match, input);
    return { structure, state: { ...state, results: { ...state.results, [match.id]: result } } };
  }

  const result = duelResult(structure, state, match, input);
  let matches = structure.matches;
  let skipped = state.skipped;
  const fill = (targetId: string | null, outcome: 'winner' | 'loser', entrantId: string | null): void => {
    if (targetId === null) return;
    const index = matches.findIndex((m) => m.id === targetId);
    const target = matches[index] as MatchNode;
    const needed = !target.ifNecessary || result.winnerId !== match.slots[0]?.entrantId;
    if (target.ifNecessary) {
      skipped = needed ? skipped.filter((id) => id !== target.id) : [...skipped.filter((id) => id !== target.id), target.id];
    }
    const slots = target.slots.map((slot) =>
      slot.source?.matchId === match.id && slot.source.outcome === outcome ? { ...slot, entrantId: needed ? entrantId : null } : slot,
    );
    matches = matches.slice();
    matches[index] = { ...target, slots };
  };
  fill(match.nextMatchId, 'winner', result.winnerId);
  fill(match.loserNextMatchId, 'loser', result.loserId);

  return {
    structure: matches === structure.matches ? structure : { ...structure, matches },
    state: { ...state, results: { ...state.results, [match.id]: result }, skipped },
  };
}

function walkoverInput(structure: StageStructure, match: MatchNode, winnerId: string): MatchResultInput {
  const ids = match.slots.map((slot) => slot.entrantId);
  if (match.kind !== 'DUEL' || match.slots.length !== 2 || ids.includes(null)) {
    throw new EngineError('MATCH_NOT_READY', 'Só é possível aplicar W.O. em um duelo com os dois participantes definidos.');
  }
  if (!ids.includes(winnerId)) throw invalidResult('O vencedor informado não está na partida.');
  const loserId = ids.find((id) => id !== winnerId) as string;
  const score = match.bestOf > 1 ? Math.ceil(match.bestOf / 2) : (structure.config.walkoverScore ?? 3);
  return {
    matchId: match.id,
    winnerId,
    walkover: true,
    entries: [
      { entrantId: winnerId, score },
      { entrantId: loserId, score: 0 },
    ],
  };
}

/** Nos formatos eliminatórios, quem saiu perde por W.O. toda partida em que aparecer (RN-06). */
function settle(snapshot: StageSnapshot): StageSnapshot {
  if (!isEliminationFormat(snapshot.structure.format)) return snapshot;
  if (Object.keys(snapshot.state.entrantStatus).length === 0) return snapshot;
  let current = snapshot;
  for (;;) {
    const { structure, state } = current;
    const pending = structure.matches.find((match) => {
      if (state.results[match.id] || state.skipped.includes(match.id)) return false;
      const ids = match.slots.map((slot) => slot.entrantId);
      return !ids.includes(null) && ids.some((id) => state.entrantStatus[id as string] !== undefined);
    });
    if (!pending) return current;
    const ids = pending.slots.map((slot) => slot.entrantId as string);
    const winnerId = ids.find((id) => state.entrantStatus[id] === undefined) ?? (ids[0] as string);
    current = applyCore(current, walkoverInput(structure, pending, winnerId));
  }
}

/**
 * Registra o resultado de uma partida e propaga vencedor e perdedor para as
 * próximas. Não altera a entrada: devolve a nova estrutura e o novo estado.
 *
 * Reaplicar em uma partida já concluída corrige o resultado, desde que a
 * partida seguinte ainda não tenha sido concluída.
 */
export function applyResult(structure: StageStructure, state: StageState, input: MatchResultInput): StageSnapshot {
  return settle(applyCore({ structure, state }, input));
}

/** W.O.: vitória pelo placar configurado (RN-04) — vitórias necessárias na série ou `config.walkoverScore`. */
export function applyWalkover(
  structure: StageStructure,
  state: StageState,
  input: { matchId: string; winnerId: string },
): StageSnapshot {
  const match = findMatch(structure, input.matchId);
  if (match.kind === 'LOBBY') {
    throw invalidResult('Em Battle Royale não há W.O. da partida: lance a equipe como ausente na queda.');
  }
  return applyResult(structure, state, walkoverInput(structure, match, input.winnerId));
}

/**
 * Troca dois participantes de lugar (arrastar e soltar). Só antes do início:
 * depois do primeiro resultado a chave fica travada (RN-07).
 */
export function swapEntrants(structure: StageStructure, entrantIdA: string, entrantIdB: string, state?: StageState): StageStructure {
  if (state && Object.keys(state.results).length > 0) {
    throw new EngineError('STAGE_STARTED', 'A chave não pode mais ser alterada: já existe partida concluída.');
  }
  const indexA = structure.entrants.findIndex((entrant) => entrant.id === entrantIdA);
  const indexB = structure.entrants.findIndex((entrant) => entrant.id === entrantIdB);
  if (indexA < 0 || indexB < 0) throw new EngineError('ENTRANT_NOT_FOUND', 'Participante não encontrado nesta fase.');
  if (indexA === indexB) throw new EngineError('INVALID_ENTRANTS', 'Escolha dois participantes diferentes para trocar.');

  const swap = (id: string): string => (id === entrantIdA ? entrantIdB : id === entrantIdB ? entrantIdA : id);
  const entrants = structure.entrants.slice();
  const a = entrants[indexA] as (typeof entrants)[number];
  const b = entrants[indexB] as (typeof entrants)[number];
  entrants[indexA] = { ...b, seed: a.seed };
  entrants[indexB] = { ...a, seed: b.seed };

  return {
    ...structure,
    entrants,
    groups: structure.groups.map((group) => ({ ...group, entrantIds: group.entrantIds.map(swap) })),
    matches: structure.matches.map((match) => {
      if (!match.slots.some((slot) => slot.entrantId === entrantIdA || slot.entrantId === entrantIdB)) return match;
      return {
        ...match,
        slots: match.slots.map((slot) => (slot.entrantId === null ? slot : { ...slot, entrantId: swap(slot.entrantId) })),
      };
    }),
  };
}

const voidedResult = (matchId: string, previous: MatchResult | undefined): MatchResult =>
  previous
    ? { ...previous, voided: true }
    : { matchId, entries: [], winnerId: null, loserId: null, draw: false, walkover: false, voided: true };

/**
 * Desistência (`WITHDRAWN`) ou desclassificação (`DISQUALIFIED`) com a fase em
 * andamento, conforme a RN-06:
 *
 * - Eliminatórias: a partida atual e as futuras viram W.O. para o adversário.
 * - Pontos corridos e grupos de duelos: desclassificado, ou desistente com menos
 *   da metade dos jogos feitos, tem todos os resultados anulados; desistente com
 *   metade ou mais perde os jogos restantes por W.O.
 * - Suíço: sai dos próximos pareamentos (a partida pendente vira W.O.).
 * - Battle Royale: sai das quedas futuras.
 *
 * A tabela (`computeStandings`) zera os pontos do desclassificado (RN-05).
 */
export function withdrawEntrant(
  structure: StageStructure,
  state: StageState,
  input: { entrantId: string; kind: EntrantStatus },
): StageSnapshot {
  const { entrantId, kind } = input;
  if (!structure.entrants.some((entrant) => entrant.id === entrantId)) {
    throw new EngineError('ENTRANT_NOT_FOUND', 'Participante não encontrado nesta fase.');
  }
  if (kind !== 'WITHDRAWN' && kind !== 'DISQUALIFIED') throw invalidResult('Informe se é desistência ou desclassificação.');
  if (state.entrantStatus[entrantId] === 'DISQUALIFIED') return { structure, state };

  let current: StageSnapshot = {
    structure,
    state: { ...state, entrantStatus: { ...state.entrantStatus, [entrantId]: kind } },
  };
  if (isEliminationFormat(structure.format)) return settle(current);

  const duels = structure.matches.filter(
    (match) => match.kind === 'DUEL' && match.slots.length === 2 && match.slots.some((slot) => slot.entrantId === entrantId),
  );
  const opponentOf = (match: MatchNode): string => match.slots.find((slot) => slot.entrantId !== entrantId)?.entrantId as string;

  if (structure.format === 'SWISS') {
    for (const match of duels) {
      if (!current.state.results[match.id]) {
        current = applyCore(current, walkoverInput(current.structure, match, opponentOf(match)));
      }
    }
    return current;
  }

  // ROUND_ROBIN e GROUPS em duelos. (Em quedas BR não há duelo: basta o status.)
  const played = duels.filter((match) => {
    const result = current.state.results[match.id];
    return result !== undefined && !result.voided;
  }).length;
  const annul = kind === 'DISQUALIFIED' || played < duels.length / 2;
  const results = { ...current.state.results };
  for (const match of duels) {
    const previous = results[match.id];
    if (annul) {
      results[match.id] = voidedResult(match.id, previous);
    } else if (!previous) {
      const opponent = opponentOf(match);
      if (current.state.entrantStatus[opponent] !== undefined) {
        results[match.id] = voidedResult(match.id, undefined);
      } else {
        results[match.id] = duelResult(current.structure, current.state, match, walkoverInput(current.structure, match, opponent));
      }
    }
  }
  return { structure: current.structure, state: { ...current.state, results } };
}
