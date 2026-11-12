import { describe, expect, it } from 'vitest';
import { EngineError, bracketOrder, createPrng, generateStage, randomSeed, seedEntrants, snakeDistribute } from '../src/index';
import { makeEntrants } from './helpers';

describe('PRNG determinístico', () => {
  it('mesma seed, mesma sequência', () => {
    const a = createPrng('nova-arena');
    const b = createPrng('nova-arena');
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('seeds diferentes, sequências diferentes', () => {
    expect(createPrng('a').next()).not.toBe(createPrng('b').next());
  });

  it('int fica no intervalo e shuffle não altera a entrada', () => {
    const prng = createPrng('x');
    for (let i = 0; i < 200; i++) expect(prng.int(7)).toBeLessThan(7);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = prng.shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('randomSeed devolve texto novo a cada chamada', () => {
    const a = randomSeed();
    expect(a).toMatch(/^[0-9a-z]{14}$/);
    expect(randomSeed()).not.toBe(a);
  });
});

describe('seeding', () => {
  it('RANDOM: mesma seed = mesma ordem, seeds numeradas', () => {
    const a = seedEntrants(makeEntrants(16), 'RANDOM', 'copa-1');
    const b = seedEntrants(makeEntrants(16), 'RANDOM', 'copa-1');
    const c = seedEntrants(makeEntrants(16), 'RANDOM', 'copa-2');
    expect(a).toEqual(b);
    expect(a.map((e) => e.id)).not.toEqual(c.map((e) => e.id));
    expect(a.map((e) => e.seed)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it('RANKED: por seed, depois por rating, depois pela ordem recebida', () => {
    const ordered = seedEntrants(
      [
        { id: 'sem-nada' },
        { id: 'rating-baixo', rating: 900 },
        { id: 'seed-2', seed: 2, rating: 10 },
        { id: 'rating-alto', rating: 1500 },
        { id: 'seed-1', seed: 1 },
        { id: 'sem-nada-2' },
      ],
      'RANKED',
      '',
    );
    expect(ordered.map((e) => e.id)).toEqual(['seed-1', 'seed-2', 'rating-alto', 'rating-baixo', 'sem-nada', 'sem-nada-2']);
    expect(ordered.map((e) => e.seed)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('MANUAL: mantém a ordem recebida', () => {
    const ids = ['c', 'a', 'b'];
    expect(seedEntrants(ids.map((id) => ({ id })), 'MANUAL', '').map((e) => e.id)).toEqual(ids);
  });

  it('recusa participante repetido, sem id ou lista curta', () => {
    expect(() => seedEntrants([{ id: 'a' }, { id: 'a', name: 'Alfa' }], 'MANUAL', '')).toThrow('Alfa aparece mais de uma vez');
    expect(() => seedEntrants([{ id: 'a' }, { id: '' }], 'MANUAL', '')).toThrow('sem identificador');
    expect(() => seedEntrants([{ id: 'a' }], 'RANKED', '')).toThrow(EngineError);
    expect(() => seedEntrants(makeEntrants(2), 'OUTRO' as never, '')).toThrow('seeding inválido');
  });

  it('bracketOrder segue o padrão 1 x último', () => {
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('snakeDistribute vai e volta pelos potes', () => {
    expect(snakeDistribute([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([[1, 8, 9], [2, 7, 10], [3, 6], [4, 5]]);
  });
});

describe('generateStage — seed registrada', () => {
  it('RANDOM sem seed sorteia uma e devolve em seedUsed; reutilizá-la reproduz a chave', () => {
    const first = generateStage({ format: 'SINGLE_ELIM', entrants: makeEntrants(13), seeding: 'RANDOM' });
    expect(first.seedUsed).not.toBe('');
    const again = generateStage({ format: 'SINGLE_ELIM', entrants: makeEntrants(13), seeding: 'RANDOM', seed: first.seedUsed });
    expect(again).toEqual(first);
  });

  it('RANKED e MANUAL sem seed registram seed vazia', () => {
    expect(generateStage({ format: 'ROUND_ROBIN', entrants: makeEntrants(4), seeding: 'RANKED' }).seedUsed).toBe('');
    expect(generateStage({ format: 'ROUND_ROBIN', entrants: makeEntrants(4), seeding: 'MANUAL', seed: 's' }).seedUsed).toBe('s');
  });

  it('recusa formato desconhecido', () => {
    expect(() => generateStage({ format: 'LIGA' as never, entrants: makeEntrants(4), seeding: 'RANKED' })).toThrow(
      'Formato de fase inválido.',
    );
  });
});
