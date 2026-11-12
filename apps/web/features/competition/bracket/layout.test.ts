import { describe, expect, it } from 'vitest';
import { bracketFixture } from '../test/fixtures';
import { BOX_H, BOX_W, computeBracketLayout, shortRoundLabel } from './layout';
import { neighborMatch } from './navigation';

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x < b.x + BOX_W && b.x < a.x + BOX_W && a.y < b.y + BOX_H && b.y < a.y + BOX_H;
}

describe('computeBracketLayout', () => {
  for (const n of [8, 16, 32]) {
    for (const format of ['SINGLE_ELIM', 'DOUBLE_ELIM'] as const) {
      it(`${format} com ${n}: uma caixa por partida, sem sobreposição e dentro da área`, () => {
        const bracket = bracketFixture(n, format, { thirdPlace: format === 'SINGLE_ELIM' });
        const layout = computeBracketLayout(bracket.matches);
        expect(layout.boxes).toHaveLength(bracket.matches.length);
        for (let i = 0; i < layout.boxes.length; i++) {
          const a = layout.boxes[i]!;
          expect(a.x).toBeGreaterThanOrEqual(0);
          expect(a.y).toBeGreaterThanOrEqual(0);
          expect(a.x + BOX_W).toBeLessThanOrEqual(layout.width);
          expect(a.y + BOX_H).toBeLessThanOrEqual(layout.height);
          for (let j = i + 1; j < layout.boxes.length; j++) expect(overlaps(a, layout.boxes[j]!)).toBe(false);
        }
      });
    }
  }

  it('eliminação simples: cada partida fica entre as duas que a alimentam', () => {
    const layout = computeBracketLayout(bracketFixture(16).matches);
    const byId = new Map(layout.boxes.map((b) => [b.match.id, b]));
    for (const box of layout.boxes.filter((b) => b.match.bracket === 'WINNERS' && b.match.round > 1)) {
      const feeders = layout.boxes.filter((b) => b.match.nextMatchId === box.match.id);
      expect(feeders).toHaveLength(2);
      const mid = (feeders[0]!.y + feeders[1]!.y) / 2;
      expect(byId.get(box.match.id)!.y).toBeCloseTo(mid, 5);
    }
    // 15 partidas: todas, menos a final, apontam para a próxima.
    expect(layout.connectors).toHaveLength(14);
  });

  it('eliminação dupla: seções superior e inferior e a Grande Final à direita de tudo', () => {
    const layout = computeBracketLayout(bracketFixture(8, 'DOUBLE_ELIM').matches);
    expect(layout.sections.map((s) => s.label)).toEqual(['Chave superior', 'Chave inferior']);
    const finals = layout.boxes.filter((b) => b.section === 'FINAL');
    expect(finals.length).toBeGreaterThanOrEqual(1);
    const maxOther = Math.max(...layout.boxes.filter((b) => b.section !== 'FINAL').map((b) => b.x));
    for (const f of finals) expect(f.x).toBeGreaterThan(maxOther);
  });

  it('byes deixam a partida na posição da árvore (não sobe para o topo)', () => {
    const layout = computeBracketLayout(bracketFixture(6).matches);
    const round2 = layout.boxes.filter((b) => b.match.round === 2 && b.match.bracket === 'WINNERS').sort((a, b) => a.y - b.y);
    expect(round2).toHaveLength(2);
    expect(round2[1]!.y).toBeGreaterThan(round2[0]!.y + BOX_H);
  });

  it('rótulo curto da coluna', () => {
    expect(shortRoundLabel('Semifinal da chave superior')).toBe('Semifinal');
    expect(shortRoundLabel('Chave inferior · Rodada 2')).toBe('Rodada 2');
    expect(shortRoundLabel('Quartas de final')).toBe('Quartas de final');
  });
});

describe('neighborMatch', () => {
  const layout = computeBracketLayout(bracketFixture(8).matches);
  const id = (round: number, position: number) => layout.boxes.find((b) => b.match.round === round && b.match.position === position && b.match.bracket === 'WINNERS')!.match.id;

  it('↓ e ↑ andam na mesma rodada', () => {
    expect(neighborMatch(layout, id(1, 1), 'ArrowDown')).toBe(id(1, 2));
    expect(neighborMatch(layout, id(1, 2), 'ArrowUp')).toBe(id(1, 1));
    expect(neighborMatch(layout, id(1, 1), 'ArrowUp')).toBeNull();
  });

  it('→ vai para a próxima partida e ← volta para quem alimenta', () => {
    expect(neighborMatch(layout, id(1, 3), 'ArrowRight')).toBe(id(2, 2));
    expect([id(1, 3), id(1, 4)]).toContain(neighborMatch(layout, id(2, 2), 'ArrowLeft'));
    expect(neighborMatch(layout, id(3, 1), 'ArrowRight')).toBeNull();
  });

  it('Home e End', () => {
    expect(neighborMatch(layout, id(2, 1), 'Home')).toBe(id(1, 1));
    expect(neighborMatch(layout, id(1, 1), 'End')).toBe(id(3, 1));
  });
});
