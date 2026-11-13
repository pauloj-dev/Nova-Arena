/**
 * Layout da chave eliminatória: posição de cada confronto a partir de `round`, `position` e
 * `bracket` (estrutura do motor, `packages/engine/README.md`). Função pura, sem DOM — a chave
 * em SVG só desenha o que sai daqui.
 *
 * - Chave de vencedores (e eliminação simples): árvore por posição. Os filhos da partida `p` da
 *   rodada `r` são `2p−1` e `2p` da rodada `r−1`; com byes a rodada 1 tem buracos, e o lugar
 *   deles fica vazio (o confronto seguinte continua na altura certa).
 * - Chave de perdedores: o motor renumera rodadas e posições depois de tirar os byes, então a
 *   altura vem da média das partidas que alimentam cada confronto.
 * - Grande Final (e reset): colunas à direita das duas chaves.
 * - Disputa de 3º lugar: abaixo da final, na mesma coluna.
 */
import type { Match } from '@nova/schemas';

export type BracketSection = 'WINNERS' | 'LOSERS' | 'FINAL';

export interface LayoutMetrics {
  cardWidth: number;
  cardHeight: number;
  /** Espaço horizontal entre colunas (onde passam os conectores). */
  columnGap: number;
  /** Espaço vertical mínimo entre dois confrontos. */
  rowGap: number;
  /** Altura do rótulo da rodada, acima de cada coluna. */
  headerHeight: number;
  /** Altura do título de cada chave na eliminação dupla. */
  sectionTitleHeight: number;
  /** Espaço entre a chave de vencedores e a de perdedores. */
  sectionGap: number;
  padding: number;
}

export const DEFAULT_METRICS: LayoutMetrics = {
  cardWidth: 248,
  cardHeight: 96,
  columnGap: 56,
  rowGap: 20,
  headerHeight: 32,
  sectionTitleHeight: 32,
  sectionGap: 40,
  padding: 16,
};

export interface LayoutNode {
  id: string;
  match: Match;
  section: BracketSection;
  /** Coluna global (0 = mais à esquerda). */
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutConnector {
  id: string;
  fromId: string;
  toId: string;
  /** Atributo `d` do `<path>`: sai da direita do confronto e entra pela esquerda do seguinte. */
  d: string;
}

export interface LayoutColumn {
  key: string;
  section: BracketSection | 'THIRD_PLACE';
  label: string;
  x: number;
  /** Linha de base do rótulo. */
  y: number;
  width: number;
}

export interface LayoutSectionTitle {
  section: BracketSection;
  label: string;
  x: number;
  y: number;
}

export interface BracketLayout {
  nodes: LayoutNode[];
  connectors: LayoutConnector[];
  columns: LayoutColumn[];
  sectionTitles: LayoutSectionTitle[];
  width: number;
  height: number;
  /** Eliminação dupla (tem chave de perdedores ou Grande Final). */
  double: boolean;
}

export const SECTION_LABELS: Record<BracketSection, string> = {
  WINNERS: 'Chave de vencedores',
  LOSERS: 'Chave de perdedores',
  FINAL: 'Grande Final',
};

const byPosition = (a: Match, b: Match) => a.position - b.position;

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Só os confrontos que entram na chave em árvore (duelos com `bracket`). */
export function eliminationMatches(matches: readonly Match[]): Match[] {
  return matches.filter((m) => m.kind === 'DUEL' && m.bracket !== null);
}

export function layoutBracket(all: readonly Match[], metrics: LayoutMetrics = DEFAULT_METRICS): BracketLayout {
  const m = metrics;
  const matches = eliminationMatches(all);
  const winners = matches.filter((x) => x.bracket === 'WINNERS');
  const losers = matches.filter((x) => x.bracket === 'LOSERS');
  const finals = matches.filter((x) => x.bracket === 'FINAL').sort((a, b) => a.round - b.round);
  const third = matches.filter((x) => x.bracket === 'THIRD_PLACE');
  const double = losers.length > 0 || finals.length > 0;

  const unit = m.cardHeight + m.rowGap;
  const step = m.cardWidth + m.columnGap;
  const titleHeight = double ? m.sectionTitleHeight : 0;
  const colX = (column: number) => m.padding + column * step;

  const nodes: LayoutNode[] = [];
  const columns: LayoutColumn[] = [];
  const sectionTitles: LayoutSectionTitle[] = [];
  const centers = new Map<string, number>();
  const place = (match: Match, section: BracketSection, column: number, centerY: number) => {
    centers.set(match.id, centerY);
    nodes.push({ id: match.id, match, section, column, x: colX(column), y: centerY - m.cardHeight / 2, width: m.cardWidth, height: m.cardHeight });
  };

  // ── Chave de vencedores ────────────────────────────────────────────
  const winnersTop = m.padding + titleHeight + m.headerHeight;
  const winnerRounds = uniqueSorted(winners.map((x) => x.round));
  const firstRound = winnerRounds[0] ?? 1;
  /** Linhas da 1ª rodada que a árvore inteira ocupa (contando os buracos dos byes). */
  const leafRows = Math.max(1, ...winners.map((x) => x.position * 2 ** (x.round - firstRound)));
  for (const match of winners) {
    const span = 2 ** (match.round - firstRound);
    place(match, 'WINNERS', match.round - firstRound, winnersTop + (match.position - 0.5) * span * unit);
  }
  const winnerColumns = winnerRounds.length === 0 ? 0 : (winnerRounds[winnerRounds.length - 1] as number) - firstRound + 1;
  for (const round of winnerRounds) {
    const sample = winners.filter((x) => x.round === round).sort(byPosition)[0];
    if (sample) columns.push({ key: `W-${round}`, section: 'WINNERS', label: sample.roundLabel, x: colX(round - firstRound), y: winnersTop - 12, width: m.cardWidth });
  }
  if (double && winners.length > 0) sectionTitles.push({ section: 'WINNERS', label: SECTION_LABELS.WINNERS, x: m.padding, y: m.padding + titleHeight - 10 });
  let winnersBottom = winnersTop + leafRows * unit;

  // Disputa de 3º lugar: logo abaixo da final.
  for (const match of third) {
    const final = winners.find((x) => x.round === match.round && x.position === 1) ?? winners.filter((x) => x.round === winnerRounds[winnerRounds.length - 1])[0];
    const finalCenter = final ? (centers.get(final.id) ?? winnersTop + unit / 2) : winnersTop + unit / 2;
    const column = final ? final.round - firstRound : Math.max(0, winnerColumns - 1);
    const center = finalCenter + m.cardHeight + m.headerHeight + m.rowGap;
    place(match, 'WINNERS', column, center);
    columns.push({ key: `T-${match.id}`, section: 'THIRD_PLACE', label: match.roundLabel, x: colX(column), y: center - m.cardHeight / 2 - 12, width: m.cardWidth });
    winnersBottom = Math.max(winnersBottom, center + m.cardHeight / 2 + m.rowGap / 2);
  }

  // ── Chave de perdedores ────────────────────────────────────────────
  const loserRounds = uniqueSorted(losers.map((x) => x.round));
  let bottom = winnersBottom;
  if (losers.length > 0) {
    const sectionTop = winnersBottom + m.sectionGap;
    const losersTop = sectionTop + titleHeight + m.headerHeight;
    sectionTitles.push({ section: 'LOSERS', label: SECTION_LABELS.LOSERS, x: m.padding, y: sectionTop + titleHeight - 10 });
    loserRounds.forEach((round, column) => {
      const inRound = losers.filter((x) => x.round === round).sort(byPosition);
      let cursor = losersTop + unit / 2;
      for (const match of inRound) {
        const feeders = losers.filter((f) => f.nextMatchId === match.id).map((f) => centers.get(f.id)).filter((y): y is number => y !== undefined);
        const wanted = feeders.length > 0 ? feeders.reduce((s, y) => s + y, 0) / feeders.length : cursor;
        const center = Math.max(wanted, cursor);
        place(match, 'LOSERS', column, center);
        cursor = center + unit;
        bottom = Math.max(bottom, center + unit / 2);
      }
      const sample = inRound[0];
      if (sample) columns.push({ key: `L-${round}`, section: 'LOSERS', label: sample.roundLabel, x: colX(column), y: losersTop - 12, width: m.cardWidth });
    });
  }

  // ── Grande Final ───────────────────────────────────────────────────
  const finalsColumn = Math.max(winnerColumns, loserRounds.length);
  const lastWinnerRound = winnerRounds[winnerRounds.length - 1];
  const winnersFinal = winners.find((x) => x.round === lastWinnerRound && x.position === 1);
  const finalsCenter = winnersFinal ? (centers.get(winnersFinal.id) ?? winnersTop + unit / 2) : winnersTop + unit / 2;
  finals.forEach((match, i) => {
    place(match, 'FINAL', finalsColumn + i, finalsCenter);
    columns.push({ key: `F-${match.round}`, section: 'FINAL', label: match.roundLabel, x: colX(finalsColumn + i), y: finalsCenter - m.cardHeight / 2 - 12, width: m.cardWidth });
  });

  // ── Conectores (vencedor → próximo confronto) ──────────────────────
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const connectors: LayoutConnector[] = [];
  for (const node of nodes) {
    const target = node.match.nextMatchId ? byId.get(node.match.nextMatchId) : undefined;
    if (!target) continue;
    const x1 = node.x + node.width;
    const y1 = node.y + node.height / 2;
    const x2 = target.x;
    const y2 = target.y + target.height / 2;
    const mid = x2 - m.columnGap / 2;
    connectors.push({ id: `${node.id}→${target.id}`, fromId: node.id, toId: target.id, d: y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}` });
  }

  const columnCount = Math.max(1, winnerColumns, loserRounds.length, finalsColumn + finals.length);
  return {
    nodes,
    connectors,
    columns,
    sectionTitles,
    width: m.padding * 2 + columnCount * step - m.columnGap,
    height: Math.max(bottom, ...nodes.map((n) => n.y + n.height)) + m.padding,
    double,
  };
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Para onde vai o foco com as setas do teclado:
 * → o confronto seguinte (quem vence vai para lá) · ← o confronto que alimenta este ·
 * ↑ ↓ o vizinho de cima/baixo na mesma coluna. Nulo quando não há para onde ir.
 */
export function neighbor(layout: Pick<BracketLayout, 'nodes'>, id: string, direction: Direction): string | null {
  const node = layout.nodes.find((n) => n.id === id);
  if (!node) return null;
  const center = (n: LayoutNode) => n.y + n.height / 2;
  const nearest = (candidates: LayoutNode[]) => candidates.sort((a, b) => Math.abs(center(a) - center(node)) - Math.abs(center(b) - center(node)))[0]?.id ?? null;

  if (direction === 'up' || direction === 'down') {
    const column = layout.nodes.filter((n) => n.column === node.column).sort((a, b) => a.y - b.y);
    const i = column.findIndex((n) => n.id === id);
    return column[direction === 'up' ? i - 1 : i + 1]?.id ?? null;
  }
  if (direction === 'right') {
    const next = node.match.nextMatchId ? layout.nodes.find((n) => n.id === node.match.nextMatchId) : undefined;
    if (next) return next.id;
    const columns = uniqueSorted(layout.nodes.map((n) => n.column)).filter((c) => c > node.column);
    return columns.length > 0 ? nearest(layout.nodes.filter((n) => n.column === columns[0])) : null;
  }
  const feeders = layout.nodes.filter((n) => n.match.nextMatchId === id).sort((a, b) => a.y - b.y);
  if (feeders[0]) return feeders[0].id;
  const columns = uniqueSorted(layout.nodes.map((n) => n.column)).filter((c) => c < node.column);
  return columns.length > 0 ? nearest(layout.nodes.filter((n) => n.column === columns[columns.length - 1])) : null;
}

export interface ParticipantPath {
  /** Confrontos em que a inscrição joga ou jogou. */
  matchIds: Set<string>;
  /** Conectores entre dois confrontos do caminho já percorrido. */
  connectorIds: Set<string>;
  /** Conectores do caminho ainda possível (se continuar vencendo), para desenhar tracejado. */
  projectedConnectorIds: Set<string>;
}

/** Caminho de um participante na chave: por onde passou e por onde ainda pode passar. */
export function participantPath(layout: Pick<BracketLayout, 'nodes' | 'connectors'>, registrationId: string | null | undefined): ParticipantPath {
  const path: ParticipantPath = { matchIds: new Set(), connectorIds: new Set(), projectedConnectorIds: new Set() };
  if (!registrationId) return path;
  for (const node of layout.nodes) if (node.match.participants.some((p) => p.registrationId === registrationId)) path.matchIds.add(node.id);
  for (const c of layout.connectors) if (path.matchIds.has(c.fromId) && path.matchIds.has(c.toId)) path.connectorIds.add(c.id);

  // Ainda vivo: o confronto dele sem resultado. Dali em diante, o caminho de quem vence.
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const pending = layout.nodes.find((n) => path.matchIds.has(n.id) && n.match.participants.some((p) => p.registrationId === registrationId && p.isWinner === null) && n.match.status !== 'CANCELLED');
  let current = pending;
  const seen = new Set<string>();
  while (current && current.match.nextMatchId && !seen.has(current.id)) {
    seen.add(current.id);
    const next = byId.get(current.match.nextMatchId);
    if (!next) break;
    path.projectedConnectorIds.add(`${current.id}→${next.id}`);
    current = next;
  }
  return path;
}
