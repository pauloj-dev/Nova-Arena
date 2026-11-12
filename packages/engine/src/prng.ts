export interface Prng {
  /** Próximo número em [0, 1). */
  next(): number;
  /** Inteiro em [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Cópia embaralhada (Fisher–Yates). Não altera a entrada. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Hash xmur3: transforma a string em um inteiro de 32 bits. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Gerador determinístico (mulberry32): a mesma seed gera sempre a mesma sequência. */
export function createPrng(seed: string): Prng {
  let a = hashSeed(seed);
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  };
  return { next, int, shuffle };
}

/** Seed nova para um sorteio (não determinística). Registre o valor devolvido. */
export function randomSeed(): string {
  const part = (): string => Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0');
  return `${part()}${part()}`;
}
