import type { Match } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METRICS, layoutBracket, neighbor, participantPath, type BracketLayout, type LayoutNode } from './layout';
import { bracketSides, defaultRound, defaultSide, stageRounds } from './rounds';
import { buildStage, matchId } from './test/fixtures';

const M = DEFAULT_METRICS;
const UNIT = M.cardHeight + M.rowGap;

function node(layout: BracketLayout, nodeId: string): LayoutNode {
  const found = layout.nodes.find((n) => n.id === matchId(nodeId));
  if (!found) throw new Error(`Confronto ${nodeId} não está no layout`);
  return found;
}
const centerY = (n: LayoutNode) => n.y + n.height / 2;

function overlaps(a: LayoutNode, b: LayoutNode): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function expectSane(layout: BracketLayout, matches: Match[]): void {
  expect(layout.nodes).toHaveLength(matches.length);
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const a = layout.nodes[i] as LayoutNode;
      const b = layout.nodes[j] as LayoutNode;
      expect(overlaps(a, b), `${a.match.nodeId} sobrepõe ${b.match.nodeId}`).toBe(false);
    }
  }
  for (const n of layout.nodes) {
    expect(n.x).toBeGreaterThanOrEqual(M.padding);
    expect(n.y).toBeGreaterThanOrEqual(M.padding);
    expect(n.x + n.width).toBeLessThanOrEqual(layout.width - M.padding);
    expect(n.y + n.height).toBeLessThanOrEqual(layout.height - M.padding);
  }
  // Todo "vencedor vai para" que aponta para um confronto da chave tem conector.
  const ids = new Set(matches.map((m) => m.id));
  const expected = matches.filter((m) => m.nextMatchId && ids.has(m.nextMatchId)).length;
  expect(layout.connectors).toHaveLength(expected);
}

describe('layoutBracket — eliminação simples', () => {
  it.each([
    { count: 4, matches: 3, rounds: 2 },
    { count: 5, matches: 4, rounds: 3 },
    { count: 8, matches: 7, rounds: 3 },
    { count: 13, matches: 12, rounds: 4 },
    { count: 16, matches: 15, rounds: 4 },
    { count: 32, matches: 31, rounds: 5 },
  ])('$count participantes: $matches confrontos em $rounds colunas, sem sobreposição', ({ count, matches, rounds }) => {
    const stage = buildStage('SINGLE_ELIM', count);
    const list = stage.matches();
    expect(list).toHaveLength(matches);
    const layout = layoutBracket(list);
    expectSane(layout, list);
    expect(layout.double).toBe(false);
    expect(new Set(layout.nodes.map((n) => n.column)).size).toBe(rounds);
    expect(layout.columns.filter((c) => c.section === 'WINNERS')).toHaveLength(rounds);
    expect(layout.width).toBe(M.padding * 2 + rounds * (M.cardWidth + M.columnGap) - M.columnGap);
    // A coluna é a rodada: x cresce com `round`.
    for (const n of layout.nodes) expect(n.x).toBe(M.padding + (n.match.round - 1) * (M.cardWidth + M.columnGap));
  });

  it('cada confronto fica na altura média dos dois que o alimentam', () => {
    for (const count of [4, 8, 16, 32]) {
      const list = buildStage('SINGLE_ELIM', count).matches();
      const layout = layoutBracket(list);
      for (const n of layout.nodes) {
        const feeders = layout.nodes.filter((f) => f.match.nextMatchId === n.id);
        if (feeders.length === 2) expect(centerY(n)).toBeCloseTo((centerY(feeders[0] as LayoutNode) + centerY(feeders[1] as LayoutNode)) / 2);
      }
    }
  });

  it('a posição vem de round/position: o confronto p da rodada r ocupa as linhas dos filhos 2p−1 e 2p', () => {
    const layout = layoutBracket(buildStage('SINGLE_ELIM', 8).matches());
    const top = M.padding + M.headerHeight;
    expect(centerY(node(layout, 'w-r1-m1'))).toBe(top + 0.5 * UNIT);
    expect(centerY(node(layout, 'w-r1-m4'))).toBe(top + 3.5 * UNIT);
    expect(centerY(node(layout, 'w-r2-m1'))).toBe(top + 1 * UNIT);
    expect(centerY(node(layout, 'w-r2-m2'))).toBe(top + 3 * UNIT);
    expect(centerY(node(layout, 'w-r3-m1'))).toBe(top + 2 * UNIT);
  });

  it('5 participantes: os byes deixam buracos na 1ª rodada e a árvore continua alinhada', () => {
    const stage = buildStage('SINGLE_ELIM', 5);
    const list = stage.matches();
    const first = list.filter((m) => m.round === 1);
    expect(first).toHaveLength(1); // só 4 x 5 joga a 1ª rodada
    const layout = layoutBracket(list);
    const only = first[0] as Match;
    const top = M.padding + M.headerHeight;
    // O único confronto da rodada 1 fica na linha da própria posição, não na primeira.
    expect(centerY(node(layout, only.nodeId))).toBe(top + (only.position - 0.5) * UNIT);
    // A rodada 2 ocupa as mesmas alturas que ocuparia com a chave cheia de 8.
    expect(centerY(node(layout, 'w-r2-m1'))).toBe(top + 1 * UNIT);
    expect(centerY(node(layout, 'w-r2-m2'))).toBe(top + 3 * UNIT);
    // A vaga de quem recebeu bye vem marcada.
    expect(list.filter((m) => m.round === 2).flatMap((m) => m.participants).filter((p) => p.isBye)).toHaveLength(3);
    // O conector do confronto da rodada 1 chega no confronto certo da rodada 2.
    expect(layout.connectors.some((c) => c.fromId === only.id && c.toId === only.nextMatchId)).toBe(true);
  });

  it('13 participantes: 5 confrontos na rodada 1, cada um na linha da sua posição', () => {
    const list = buildStage('SINGLE_ELIM', 13).matches();
    const first = list.filter((m) => m.round === 1);
    expect(first).toHaveLength(5);
    const layout = layoutBracket(list);
    const top = M.padding + M.headerHeight;
    for (const m of first) expect(centerY(node(layout, m.nodeId))).toBe(top + (m.position - 0.5) * UNIT);
    // A altura é a da chave cheia de 16, mesmo com os buracos.
    expect(layout.height).toBe(top + 8 * UNIT + M.padding);
  });

  it('disputa de 3º lugar fica abaixo da final, na mesma coluna, com rótulo próprio', () => {
    const list = buildStage('SINGLE_ELIM', 8, { thirdPlace: true }).matches();
    const layout = layoutBracket(list);
    expectSane(layout, list);
    const final = node(layout, 'w-r3-m1');
    const third = node(layout, '3rd');
    expect(third.x).toBe(final.x);
    expect(third.y).toBeGreaterThan(final.y + final.height);
    expect(layout.columns.find((c) => c.section === 'THIRD_PLACE')?.label).toBe('Disputa de 3º lugar');
  });

  it('chave de 4 com 3º lugar aumenta a altura para caber', () => {
    const list = buildStage('SINGLE_ELIM', 4, { thirdPlace: true }).matches();
    const layout = layoutBracket(list);
    expectSane(layout, list);
  });

  it('equipe x equipe usa a mesma árvore', () => {
    const list = buildStage('TEAM_VS_TEAM', 8, { bestOf: 3 }).matches();
    expectSane(layoutBracket(list), list);
  });

  it('ignora partidas que não são da árvore (quedas, pontos corridos)', () => {
    const list = buildStage('ROUND_ROBIN', 4).matches();
    expect(layoutBracket(list).nodes).toHaveLength(0);
  });
});

describe('layoutBracket — eliminação dupla', () => {
  it.each([4, 6, 8, 13, 16])('%i participantes: vencedores em cima, perdedores embaixo, Grande Final à direita', (count) => {
    const list = buildStage('DOUBLE_ELIM', count, { grandFinalReset: true }).matches();
    const layout = layoutBracket(list);
    expectSane(layout, list);
    expect(layout.double).toBe(true);
    expect(layout.sectionTitles.map((t) => t.label)).toEqual(['Chave de vencedores', 'Chave de perdedores']);

    const winners = layout.nodes.filter((n) => n.section === 'WINNERS');
    const losers = layout.nodes.filter((n) => n.section === 'LOSERS');
    const finals = layout.nodes.filter((n) => n.section === 'FINAL');
    expect(losers.length).toBeGreaterThan(0);
    expect(finals.map((n) => n.match.roundLabel)).toEqual(['Grande Final', 'Grande Final (reset)']);
    expect(finals[1]?.match.ifNecessary).toBe(true);

    const winnersBottom = Math.max(...winners.map((n) => n.y + n.height));
    for (const n of losers) expect(n.y).toBeGreaterThan(winnersBottom);
    const rightmost = Math.max(...[...winners, ...losers].map((n) => n.x));
    for (const n of finals) expect(n.x).toBeGreaterThan(rightmost);
    expect((finals[1] as LayoutNode).x).toBeGreaterThan((finals[0] as LayoutNode).x);
  });

  it('na chave de perdedores, quem tem alimentadores fica na altura média deles e ninguém se sobrepõe', () => {
    const list = buildStage('DOUBLE_ELIM', 8).matches();
    const layout = layoutBracket(list);
    const losers = layout.nodes.filter((n) => n.section === 'LOSERS');
    const rounds = [...new Set(losers.map((n) => n.match.round))].sort((a, b) => a - b);
    // Colunas na ordem das rodadas da chave de perdedores.
    rounds.forEach((round, column) => {
      for (const n of losers.filter((l) => l.match.round === round)) expect(n.column).toBe(column);
    });
    const last = losers.filter((n) => n.match.round === rounds[rounds.length - 1]);
    expect(last).toHaveLength(1);
    // A final da chave de perdedores liga na Grande Final.
    expect(layout.connectors.some((c) => c.fromId === (last[0] as LayoutNode).id && c.toId === matchId('gf-1'))).toBe(true);
    expect(layout.connectors.some((c) => c.toId === matchId('gf-2') && c.fromId === matchId('gf-1'))).toBe(true);
  });

  it('sem reset não existe a segunda Grande Final', () => {
    const list = buildStage('DOUBLE_ELIM', 8, { grandFinalReset: false }).matches();
    expect(layoutBracket(list).nodes.filter((n) => n.section === 'FINAL')).toHaveLength(1);
  });
});

describe('neighbor — navegação por teclado na chave', () => {
  const layout = layoutBracket(buildStage('SINGLE_ELIM', 8, { thirdPlace: true }).matches());

  it('→ vai para o confronto seguinte e ← volta para quem o alimenta', () => {
    expect(neighbor(layout, matchId('w-r1-m1'), 'right')).toBe(matchId('w-r2-m1'));
    expect(neighbor(layout, matchId('w-r1-m4'), 'right')).toBe(matchId('w-r2-m2'));
    expect(neighbor(layout, matchId('w-r2-m2'), 'right')).toBe(matchId('w-r3-m1'));
    expect(neighbor(layout, matchId('w-r3-m1'), 'left')).toBe(matchId('w-r2-m1'));
    expect(neighbor(layout, matchId('w-r2-m2'), 'left')).toBe(matchId('w-r1-m3'));
  });

  it('↑ ↓ andam na mesma coluna (a disputa de 3º fica abaixo da final)', () => {
    expect(neighbor(layout, matchId('w-r1-m1'), 'down')).toBe(matchId('w-r1-m2'));
    expect(neighbor(layout, matchId('w-r1-m2'), 'up')).toBe(matchId('w-r1-m1'));
    expect(neighbor(layout, matchId('w-r3-m1'), 'down')).toBe(matchId('3rd'));
    expect(neighbor(layout, matchId('3rd'), 'up')).toBe(matchId('w-r3-m1'));
  });

  it('nas bordas não há para onde ir', () => {
    expect(neighbor(layout, matchId('w-r1-m1'), 'up')).toBeNull();
    expect(neighbor(layout, matchId('w-r1-m1'), 'left')).toBeNull();
    expect(neighbor(layout, matchId('w-r3-m1'), 'right')).toBeNull();
    expect(neighbor(layout, 'não-existe', 'right')).toBeNull();
  });

  it('com bye, ← cai no confronto mais próximo da coluna anterior', () => {
    const byes = layoutBracket(buildStage('SINGLE_ELIM', 5).matches());
    const only = byes.nodes.find((n) => n.match.round === 1) as LayoutNode;
    const withoutFeeder = byes.nodes.find((n) => n.match.round === 2 && n.id !== only.match.nextMatchId) as LayoutNode;
    expect(neighbor(byes, withoutFeeder.id, 'left')).toBe(only.id);
  });

  it('na dupla, → da final dos vencedores e da final dos perdedores chega na Grande Final', () => {
    const double = layoutBracket(buildStage('DOUBLE_ELIM', 8).matches());
    expect(neighbor(double, matchId('w-r3-m1'), 'right')).toBe(matchId('gf-1'));
    expect(neighbor(double, matchId('gf-1'), 'right')).toBe(matchId('gf-2'));
    // ↓ na primeira coluna atravessa da chave de vencedores para a de perdedores.
    expect(neighbor(double, matchId('w-r1-m4'), 'down')).toBe(matchId('l-r1-m1'));
  });
});

describe('participantPath — caminho de quem está vendo', () => {
  it('marca os confrontos jogados, os conectores percorridos e projeta o caminho até a final', () => {
    const stage = buildStage('SINGLE_ELIM', 8);
    stage.play('w-r1-m1', 0); // seed 1 vence e vai para a rodada 2
    const layout = layoutBracket(stage.matches());
    const path = participantPath(layout, 'r1');
    expect([...path.matchIds].sort()).toEqual([matchId('w-r1-m1'), matchId('w-r2-m1')]);
    expect([...path.connectorIds]).toEqual([`${matchId('w-r1-m1')}→${matchId('w-r2-m1')}`]);
    expect([...path.projectedConnectorIds]).toEqual([`${matchId('w-r2-m1')}→${matchId('w-r3-m1')}`]);
  });

  it('eliminado não tem caminho projetado; sem inscrição não há caminho', () => {
    const stage = buildStage('SINGLE_ELIM', 8);
    stage.play('w-r1-m1', 0);
    const layout = layoutBracket(stage.matches());
    const loser = participantPath(layout, 'r8');
    expect([...loser.matchIds]).toEqual([matchId('w-r1-m1')]);
    expect(loser.projectedConnectorIds.size).toBe(0);
    expect(participantPath(layout, null).matchIds.size).toBe(0);
  });
});

describe('rounds — chave em lista e formatos sem árvore', () => {
  it('simples: uma aba por rodada, com o 3º lugar junto da final', () => {
    const sides = bracketSides(buildStage('SINGLE_ELIM', 8, { thirdPlace: true }).matches());
    expect(sides).toHaveLength(1);
    expect(sides[0]?.rounds.map((r) => r.label)).toEqual(['Quartas de final', 'Semifinal', 'Final']);
    expect(sides[0]?.rounds[2]?.matches.map((m) => m.roundLabel)).toEqual(['Final', 'Disputa de 3º lugar']);
  });

  it('dupla: separa Vencedores, Perdedores e Final', () => {
    const sides = bracketSides(buildStage('DOUBLE_ELIM', 8).matches());
    expect(sides.map((s) => s.label)).toEqual(['Vencedores', 'Perdedores', 'Final']);
    expect(sides[2]?.rounds[0]?.matches.map((m) => m.roundLabel)).toEqual(['Grande Final', 'Grande Final (reset)']);
  });

  it('abre na rodada do confronto pendente de quem está vendo; senão na primeira por jogar; senão na última', () => {
    const stage = buildStage('SINGLE_ELIM', 8);
    const fresh = bracketSides(stage.matches())[0]?.rounds ?? [];
    expect(defaultRound(fresh)).toBe('w1');
    stage.play('w-r1-m1', 0);
    const rounds = bracketSides(stage.matches())[0]?.rounds ?? [];
    expect(defaultRound(rounds, 'r1')).toBe('w2');
    expect(defaultRound(rounds, 'r8')).toBe('w1'); // eliminado: primeira rodada ainda com jogo
    for (const id of ['w-r1-m2', 'w-r1-m3', 'w-r1-m4', 'w-r2-m1', 'w-r2-m2', 'w-r3-m1']) stage.play(id, 0);
    expect(defaultRound(bracketSides(stage.matches())[0]?.rounds ?? [])).toBe('w3');
    expect(defaultSide(bracketSides(buildStage('DOUBLE_ELIM', 8).matches()))).toBe('WINNERS');
  });

  it('grupos em quedas BR: uma aba por queda, com uma seção por grupo', () => {
    const rounds = stageRounds(buildStage('GROUPS', 24, { groupCount: 2, groupMode: 'BATTLE_ROYALE', drops: 3 }).matches());
    expect(rounds.map((r) => r.label)).toEqual(['Queda 1', 'Queda 2', 'Queda 3']);
    expect(rounds[0]?.sections.map((s) => s.name)).toEqual(['Grupo A', 'Grupo B']);
  });

  it('suíço: uma aba por rodada, sem seções de grupo', () => {
    const rounds = stageRounds(buildStage('SWISS', 8, { rounds: 3 }).matches());
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.sections).toHaveLength(1);
    expect(rounds[0]?.sections[0]?.name).toBeNull();
    expect(rounds[0]?.matches).toHaveLength(4);
  });
});
