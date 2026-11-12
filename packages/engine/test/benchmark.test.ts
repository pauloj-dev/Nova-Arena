import { describe, expect, it } from 'vitest';
import { generateStage } from '../src/index';
import type { StageFormat } from '../src/index';
import { makeEntrants } from './helpers';

/** Meta do plano (F2.1): chave de 1.024 participantes em menos de 200 ms. */
const BUDGET_MS = 200;

function medianMs(run: () => void, times = 7): number {
  run(); // aquecimento
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const startedAt = performance.now();
    run();
    samples.push(performance.now() - startedAt);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] as number;
}

describe('benchmark — 1.024 participantes', () => {
  const entrants = makeEntrants(1024);

  it.each<[StageFormat, number]>([
    ['SINGLE_ELIM', 1023],
    ['TEAM_VS_TEAM', 1023],
    ['DOUBLE_ELIM', 2047],
    ['GROUPS', 256 * 6],
    ['SWISS', 512],
    ['BATTLE_ROYALE', 86],
  ])(`%s em menos de ${BUDGET_MS} ms`, (format, expectedMatches) => {
    let count = 0;
    const elapsed = medianMs(() => {
      count = generateStage({ format, entrants, seeding: 'RANDOM', seed: 'benchmark' }).matches.length;
    });
    expect(count).toBe(expectedMatches);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('pontos corridos com 1.024 (523.776 partidas) gera sem estourar', () => {
    const structure = generateStage({ format: 'ROUND_ROBIN', entrants, seeding: 'RANKED' });
    expect(structure.matches).toHaveLength(523_776);
    expect(structure.rounds).toBe(1023);
  });
});
