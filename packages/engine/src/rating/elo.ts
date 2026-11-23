/**
 * Rating ELO da temporada (issue #120, ADR-0003). Funções puras: nada aqui lê banco, relógio ou aleatoriedade.
 *
 * - Duelo (2 participantes): ELO clássico, `K × (resultado − esperado)`. O que um ganha o outro perde.
 * - Partida com N participantes (queda de Battle Royale): cada par vira um duelo pela colocação, com `K / (N − 1)`.
 *   A variação de cada um é a soma dos seus pares. A soma das variações da partida continua sendo zero.
 * - Colocação igual = empate naquele par.
 */
import { EngineError } from '../errors';

export interface RatingConfig {
  /** Rating de quem ainda não jogou na temporada. */
  initial: number;
  /** Variação máxima de um duelo. */
  k: number;
  /** Diferença de rating em que o favorito tem 10 × mais chance (400 no ELO clássico). */
  scale: number;
  /** Abaixo de tantas partidas o rating é provisório (a tela avisa). */
  provisionalMatches: number;
}

export const DEFAULT_RATING_CONFIG: Readonly<RatingConfig> = Object.freeze({ initial: 1000, k: 32, scale: 400, provisionalMatches: 5 });

export interface RatedParticipant {
  id: string;
  rating: number;
  /** 1 = melhor. Colocação igual = empate. */
  placement: number;
}

/** Chance de `rating` vencer `opponent` (0 a 1). */
export function expectedScore(rating: number, opponent: number, scale: number = DEFAULT_RATING_CONFIG.scale): number {
  return 1 / (1 + 10 ** ((opponent - rating) / scale));
}

/** Resultado do par para `a`: 1 vitória, 0,5 empate, 0 derrota. */
const pairScore = (a: number, b: number): number => (a < b ? 1 : a === b ? 0.5 : 0);

/**
 * Variação de rating de cada participante de uma partida (soma sempre zero). Menos de 2 participantes: nada muda.
 * Lança `INVALID_RESULT` se um participante aparece duas vezes ou se a colocação não é um inteiro positivo.
 */
export function ratingDeltas(participants: readonly RatedParticipant[], config: Partial<RatingConfig> = {}): Record<string, number> {
  const cfg = { ...DEFAULT_RATING_CONFIG, ...config };
  const ids = new Set<string>();
  for (const p of participants) {
    if (ids.has(p.id)) throw new EngineError('INVALID_RESULT', 'Um participante aparece duas vezes na partida.');
    if (!Number.isInteger(p.placement) || p.placement < 1) throw new EngineError('INVALID_RESULT', 'A colocação precisa ser um número inteiro a partir de 1.');
    ids.add(p.id);
  }
  const deltas: Record<string, number> = {};
  for (const p of participants) deltas[p.id] = 0;
  if (participants.length < 2) return deltas;

  const k = cfg.k / (participants.length - 1);
  for (let i = 0; i < participants.length; i += 1) {
    const a = participants[i] as RatedParticipant;
    for (let j = i + 1; j < participants.length; j += 1) {
      const b = participants[j] as RatedParticipant;
      const change = k * (pairScore(a.placement, b.placement) - expectedScore(a.rating, b.rating, cfg.scale));
      deltas[a.id] = (deltas[a.id] as number) + change;
      deltas[b.id] = (deltas[b.id] as number) - change;
    }
  }
  return deltas;
}
