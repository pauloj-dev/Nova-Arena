import { EngineError } from './errors';
import { createPrng } from './prng';
import type { Entrant, SeedingMethod } from './types';

/** Confere a lista de participantes: ao menos 2, com ids preenchidos e sem repetição. */
export function validateEntrants(entrants: readonly Entrant[]): void {
  if (!Array.isArray(entrants) || entrants.length < 2) {
    throw new EngineError('INVALID_ENTRANTS', 'São necessários ao menos 2 participantes para gerar a chave.');
  }
  const seen = new Set<string>();
  for (const entrant of entrants) {
    if (typeof entrant?.id !== 'string' || entrant.id === '') {
      throw new EngineError('INVALID_ENTRANTS', 'Há um participante sem identificador.');
    }
    if (seen.has(entrant.id)) {
      throw new EngineError('INVALID_ENTRANTS', `O participante ${entrant.name ?? entrant.id} aparece mais de uma vez.`);
    }
    seen.add(entrant.id);
  }
}

/**
 * Ordena os participantes como cabeças de chave e numera `seed` de 1 a N.
 *
 * - `RANDOM`: sorteio determinístico a partir da seed.
 * - `RANKED`: por `seed` (menor primeiro); sem `seed`, por `rating` (maior primeiro); depois a ordem recebida.
 * - `MANUAL`: a ordem recebida.
 */
export function seedEntrants(entrants: readonly Entrant[], seeding: SeedingMethod, seed: string): Entrant[] {
  validateEntrants(entrants);
  let ordered: Entrant[];
  if (seeding === 'RANDOM') {
    ordered = createPrng(seed).shuffle(entrants);
  } else if (seeding === 'RANKED') {
    ordered = entrants
      .map((entrant, index) => ({ entrant, index }))
      .sort((a, b) => {
        const seedA = a.entrant.seed ?? Number.POSITIVE_INFINITY;
        const seedB = b.entrant.seed ?? Number.POSITIVE_INFINITY;
        if (seedA !== seedB) return seedA - seedB;
        const ratingA = a.entrant.rating ?? Number.NEGATIVE_INFINITY;
        const ratingB = b.entrant.rating ?? Number.NEGATIVE_INFINITY;
        if (ratingA !== ratingB) return ratingB - ratingA;
        return a.index - b.index;
      })
      .map((item) => item.entrant);
  } else if (seeding === 'MANUAL') {
    ordered = entrants.slice();
  } else {
    throw new EngineError('INVALID_CONFIG', 'Método de seeding inválido.');
  }
  return ordered.map((entrant, index) => ({ ...entrant, seed: index + 1 }));
}

/**
 * Ordem das seeds na 1ª rodada de uma chave de `size` vagas (potência de 2):
 * 8 → [1, 8, 4, 5, 2, 7, 3, 6]. Seeds 1 e 2 só se encontram na final.
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((s) => [s, total - s]);
  }
  return order;
}

/** Menor potência de 2 que comporta `n`. */
export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** Distribuição em serpentina: pote 1 vai A→D, pote 2 volta D→A, e assim por diante. */
export function snakeDistribute<T>(items: readonly T[], bucketCount: number): T[][] {
  const buckets: T[][] = Array.from({ length: bucketCount }, () => []);
  items.forEach((item, index) => {
    const pot = Math.floor(index / bucketCount);
    const col = index % bucketCount;
    const target = pot % 2 === 0 ? col : bucketCount - 1 - col;
    (buckets[target] as T[]).push(item);
  });
  return buckets;
}
