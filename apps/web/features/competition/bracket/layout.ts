/**
 * Posições da chave em SVG, calculadas a partir das partidas que a API devolve.
 *
 * - Chave de vencedores (e a eliminação simples): a posição da partida na árvore define a altura,
 *   então os byes deixam buracos no lugar certo e cada partida fica entre as duas que a alimentam.
 * - Chave de perdedores: as posições já vêm compactadas pelo motor; cada rodada é distribuída na
 *   altura da seção.
 * - Grande Final: à direita das duas seções, na altura média entre as duas finais que a alimentam.
 * - Disputa de 3º lugar: logo abaixo da final, na mesma coluna.
 *
 * Função pura (sem DOM) para poder ser testada e reaproveitada.
 */
import type { Match } from '@nova/schemas';

export const BOX_W = 216;
export const BOX_H = 76;
export const COL_GAP = 56;
export const ROW_GAP = 20;
export const HEADER_H = 36;
export const SECTION_GAP = 48;
export const PAD = 16;
/** Espaço para o título da seção (só na eliminação dupla). */
const SECTION_TITLE_H = 28;
/** Espaço entre a final e a disputa de 3º lugar (cabe o rótulo). */
const THIRD_GAP = 40;

export type SectionKey = 'WINNERS' | 'LOSERS' | 'FINAL';

export interface MatchBox {
  match: Match;
  section: SectionKey;
  column: number;
  /** Canto superior esquerdo da caixa. */
  x: number;
  y: number;
  /** Rótulo extra acima da caixa (ex.: "Disputa de 3º lugar" fora da coluna dela). */
  caption: string | null;
}

export interface ColumnHeader {
  key: string;
  label: string;
  x: number;
  y: number;
}

export interface SectionTitle {
  key: SectionKey;
  label: string;
  y: number;
}

export interface Connector {
  key: string;
  fromId: string;
  toId: string;
  d: string;
}

export interface BracketLayout {
  width: number;
  height: number;
  boxes: MatchBox[];
  columns: ColumnHeader[];
  sections: SectionTitle[];
  connectors: Connector[];
}

/** "Semifinal da chave superior" → "Semifinal"; "Chave inferior · Rodada 2" → "Rodada 2". */
export function shortRoundLabel(label: string): string {
  return label
    .replace(/^Chave (superior|inferior) · /, '')
    .replace(/ da chave (superior|inferior)$/, '')
    .trim();
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

const unit = BOX_H + ROW_GAP;

/** Rodadas da árvore: altura pela posição, com o número de vagas dobrando a cada rodada para trás. */
function treeSection(matches: Match[], top: number, firstColumn: number): { boxes: MatchBox[]; height: number; rounds: number[] } {
  const byRound = groupBy(matches, (m) => m.round);
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const slots = new Map<number, number>();
  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i] as number;
    const maxPosition = Math.max(...(byRound.get(round) ?? []).map((m) => m.position));
    const fromNext = i < rounds.length - 1 ? 2 * (slots.get(rounds[i + 1] as number) ?? 1) : 1;
    slots.set(round, Math.max(maxPosition, fromNext));
  }
  const height = (slots.get(rounds[0] as number) ?? 1) * unit;
  const boxes: MatchBox[] = [];
  rounds.forEach((round, index) => {
    const count = slots.get(round) ?? 1;
    const step = height / count;
    for (const match of byRound.get(round) ?? []) {
      const centerY = top + (match.position - 0.5) * step;
      boxes.push({ match, section: 'WINNERS', column: firstColumn + index, x: 0, y: centerY - BOX_H / 2, caption: null });
    }
  });
  return { boxes, height, rounds };
}

/** Rodadas compactas: cada rodada distribuída na altura da seção. */
function stackedSection(matches: Match[], top: number, firstColumn: number, section: SectionKey): { boxes: MatchBox[]; height: number; rounds: number[] } {
  const byRound = groupBy(matches, (m) => m.round);
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const maxCount = Math.max(1, ...rounds.map((r) => byRound.get(r)?.length ?? 0));
  const height = maxCount * unit;
  const boxes: MatchBox[] = [];
  rounds.forEach((round, index) => {
    const list = [...(byRound.get(round) ?? [])].sort((a, b) => a.position - b.position);
    const step = height / list.length;
    list.forEach((match, i) => {
      const centerY = top + (i + 0.5) * step;
      boxes.push({ match, section, column: firstColumn + index, x: 0, y: centerY - BOX_H / 2, caption: null });
    });
  });
  return { boxes, height, rounds };
}

const columnX = (column: number): number => PAD + column * (BOX_W + COL_GAP);

export function computeBracketLayout(matches: readonly Match[]): BracketLayout {
  const winners = matches.filter((m) => m.bracket === 'WINNERS');
  const losers = matches.filter((m) => m.bracket === 'LOSERS');
  const finals = matches.filter((m) => m.bracket === 'FINAL');
  const third = matches.filter((m) => m.bracket === 'THIRD_PLACE');
  const others = matches.filter((m) => m.bracket === null);
  const isDouble = losers.length > 0 || finals.length > 0;

  const boxes: MatchBox[] = [];
  const columns: ColumnHeader[] = [];
  const sections: SectionTitle[] = [];
  let cursorY = PAD;
  let columnCount = 0;

  const addHeaders = (sectionBoxes: MatchBox[], prefix: string, y: number) => {
    const byColumn = groupBy(sectionBoxes, (b) => b.column);
    for (const [column, list] of byColumn) {
      const first = [...list].sort((a, b) => a.match.position - b.match.position)[0] as MatchBox;
      columns.push({ key: `${prefix}-${column}`, label: shortRoundLabel(first.match.roundLabel), x: columnX(column), y });
    }
  };

  // ── Chave de vencedores (ou a chave toda na eliminação simples) ────
  if (winners.length > 0) {
    if (isDouble) {
      sections.push({ key: 'WINNERS', label: 'Chave superior', y: cursorY });
      cursorY += SECTION_TITLE_H;
    }
    const headerY = cursorY;
    cursorY += HEADER_H;
    const tree = treeSection(winners, cursorY, 0);
    let height = tree.height;
    // 3º lugar logo abaixo da final, na última coluna.
    const lastColumn = tree.rounds.length - 1;
    const finalBox = tree.boxes.find((b) => b.column === lastColumn);
    for (const match of third) {
      const y = (finalBox ? finalBox.y + BOX_H : cursorY) + THIRD_GAP;
      tree.boxes.push({ match, section: 'WINNERS', column: lastColumn, x: 0, y, caption: shortRoundLabel(match.roundLabel) });
      height = Math.max(height, y + BOX_H - cursorY + ROW_GAP);
    }
    addHeaders(
      tree.boxes.filter((b) => b.match.bracket === 'WINNERS'),
      'w',
      headerY,
    );
    boxes.push(...tree.boxes);
    columnCount = Math.max(columnCount, tree.rounds.length);
    cursorY += height;
  }

  // ── Chave de perdedores ────────────────────────────────────────────
  if (losers.length > 0) {
    cursorY += SECTION_GAP;
    sections.push({ key: 'LOSERS', label: 'Chave inferior', y: cursorY });
    cursorY += SECTION_TITLE_H;
    const headerY = cursorY;
    cursorY += HEADER_H;
    const stack = stackedSection(losers, cursorY, 0, 'LOSERS');
    addHeaders(stack.boxes, 'l', headerY);
    boxes.push(...stack.boxes);
    columnCount = Math.max(columnCount, stack.rounds.length);
    cursorY += stack.height;
  }

  // ── Partidas fora de chave (suíço, pontos corridos): uma coluna por rodada ──
  if (others.length > 0) {
    if (boxes.length > 0) cursorY += SECTION_GAP;
    const headerY = cursorY;
    cursorY += HEADER_H;
    const stack = stackedSection(others, cursorY, 0, 'WINNERS');
    addHeaders(stack.boxes, 'o', headerY);
    boxes.push(...stack.boxes);
    columnCount = Math.max(columnCount, stack.rounds.length);
    cursorY += stack.height;
  }

  // ── Grande Final ───────────────────────────────────────────────────
  if (finals.length > 0) {
    const feeders = boxes.filter((b) => finals.some((f) => b.match.nextMatchId === f.id));
    const centers = feeders.map((b) => b.y + BOX_H / 2);
    const centerY = centers.length > 0 ? (Math.min(...centers) + Math.max(...centers)) / 2 : PAD + HEADER_H + BOX_H / 2;
    const ordered = [...finals].sort((a, b) => a.round - b.round);
    ordered.forEach((match, index) => {
      const column = columnCount + index;
      boxes.push({ match, section: 'FINAL', column, x: 0, y: centerY - BOX_H / 2, caption: null });
      columns.push({ key: `f-${column}`, label: match.roundLabel, x: columnX(column), y: centerY - BOX_H / 2 - HEADER_H + 8 });
    });
    columnCount += ordered.length;
  }

  for (const box of boxes) box.x = columnX(box.column);

  // ── Ligações: da partida para a próxima, sempre para a direita ─────
  const byId = new Map(boxes.map((b) => [b.match.id, b]));
  const connectors: Connector[] = [];
  for (const from of boxes) {
    const to = from.match.nextMatchId ? byId.get(from.match.nextMatchId) : undefined;
    if (!to || to.column <= from.column) continue;
    const x1 = from.x + BOX_W;
    const y1 = from.y + BOX_H / 2;
    const x2 = to.x;
    const y2 = to.y + BOX_H / 2;
    const midX = x2 - COL_GAP / 2;
    connectors.push({ key: `${from.match.id}->${to.match.id}`, fromId: from.match.id, toId: to.match.id, d: `M${x1} ${y1} H${midX} V${y2} H${x2}` });
  }

  const width = Math.max(columnX(Math.max(columnCount, 1) - 1) + BOX_W + PAD, BOX_W + 2 * PAD);
  const bottom = Math.max(cursorY, ...boxes.map((b) => b.y + BOX_H)) + PAD;
  return { width, height: bottom, boxes, columns, sections, connectors };
}

/** Colunas na ordem de leitura (esquerda → direita, de cima para baixo dentro da coluna). */
export function columnsOf(layout: BracketLayout): MatchBox[][] {
  const grouped = groupBy(layout.boxes, (b) => `${b.section === 'LOSERS' ? 1 : 0}-${b.column}`);
  return [...grouped.entries()]
    .sort(([a], [b]) => {
      const [sa, ca] = a.split('-').map(Number) as [number, number];
      const [sb, cb] = b.split('-').map(Number) as [number, number];
      return sa - sb || ca - cb;
    })
    .map(([, list]) => list.sort((a, b) => a.y - b.y));
}
