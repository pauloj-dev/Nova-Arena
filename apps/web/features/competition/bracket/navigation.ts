/**
 * Navegação por teclado na chave (roving tabindex):
 * ↑/↓ partida de cima/de baixo na mesma rodada · → próxima partida de quem vencer ·
 * ← partida que alimenta esta · Home/End primeira/última partida.
 */
import { columnsOf, type BracketLayout, type MatchBox } from './layout';

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function isNavKey(key: string): key is NavKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End';
}

const sectionGroup = (box: MatchBox): number => (box.section === 'LOSERS' ? 1 : 0);
const centerY = (box: MatchBox): number => box.y;

function nearest(list: MatchBox[], y: number): MatchBox | undefined {
  let best: MatchBox | undefined;
  for (const box of list) if (!best || Math.abs(centerY(box) - y) < Math.abs(centerY(best) - y)) best = box;
  return best;
}

export function neighborMatch(layout: BracketLayout, currentId: string, key: NavKey): string | null {
  const lanes = columnsOf(layout);
  if (lanes.length === 0) return null;
  if (key === 'Home') return lanes[0]?.[0]?.match.id ?? null;
  if (key === 'End') {
    const last = lanes[lanes.length - 1];
    return last?.[last.length - 1]?.match.id ?? null;
  }

  const laneIndex = lanes.findIndex((lane) => lane.some((b) => b.match.id === currentId));
  const lane = lanes[laneIndex];
  if (!lane) return lanes[0]?.[0]?.match.id ?? null;
  const index = lane.findIndex((b) => b.match.id === currentId);
  const current = lane[index] as MatchBox;

  if (key === 'ArrowUp') return lane[index - 1]?.match.id ?? null;
  if (key === 'ArrowDown') return lane[index + 1]?.match.id ?? null;

  const byId = new Map(layout.boxes.map((b) => [b.match.id, b]));
  const sideLane = (delta: 1 | -1): MatchBox[] | undefined =>
    lanes.find((l) => l[0] && sectionGroup(l[0]) === sectionGroup(current) && l[0].column === current.column + delta);

  if (key === 'ArrowRight') {
    const next = current.match.nextMatchId ? byId.get(current.match.nextMatchId) : undefined;
    if (next && next.column > current.column) return next.match.id;
    return nearest(sideLane(1) ?? [], current.y)?.match.id ?? null;
  }

  // ArrowLeft: quem alimenta esta partida, o mais próximo na altura.
  const feeders = layout.boxes.filter((b) => b.match.nextMatchId === currentId && b.column < current.column);
  const feeder = nearest(feeders, current.y);
  if (feeder) return feeder.match.id;
  return nearest(sideLane(-1) ?? [], current.y)?.match.id ?? null;
}
