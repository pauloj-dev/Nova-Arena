/**
 * Modo telão (issue #124): leitura dos parâmetros da URL e montagem das "páginas" que giram na tela.
 * Funções puras, sem React, para testar sem navegador.
 */
import type { Bracket, Match, Stage, StandingRow, Standings } from '@nova/schemas';
import { bracketSides, defaultRound, isEliminationFormat, stageRounds } from '@/features/brackets/rounds';

export type TelaoView = 'tabela' | 'chave';
export type TelaoTheme = 'claro' | 'escuro';

export interface TelaoOptions {
  /** Fase pedida em `?fase=`; nula = a fase atual do campeonato. */
  stageId: string | null;
  /** `?fundo=transparente`: sem fundo, para sobrepor ao jogo no OBS. */
  transparent: boolean;
  /** Tempo de cada página da rotação, em milissegundos (`?intervalo=` em segundos, de 5 a 120). */
  intervalMs: number;
  /** `?tema=claro|escuro`; padrão escuro (contraste melhor em transmissão). */
  theme: TelaoTheme;
}

export const DEFAULT_INTERVAL_SECONDS = 12;
const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 120;

/** Linhas de classificação por página: cabem em 1080 px com a fonte grande. */
export const ROWS_PER_PAGE = 10;
/** Confrontos por página nos grupos e salas (duas colunas). */
export const MATCHES_PER_PAGE = 8;
/** Confrontos por coluna no mata-mata (uma coluna por rodada). */
export const MATCHES_PER_COLUMN = 4;
/** Rodadas lado a lado numa página da chave eliminatória. */
export const ROUNDS_PER_PAGE = 3;

type Params = Pick<URLSearchParams, 'get'>;

export function parseTelaoOptions(params: Params): TelaoOptions {
  const stageId = params.get('fase')?.trim() || null;
  const transparent = params.get('fundo')?.trim().toLowerCase() === 'transparente';
  const raw = Number.parseInt(params.get('intervalo') ?? '', 10);
  const seconds = Number.isFinite(raw) ? Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, raw)) : DEFAULT_INTERVAL_SECONDS;
  const theme: TelaoTheme = params.get('tema')?.trim().toLowerCase() === 'claro' ? 'claro' : 'escuro';
  return { stageId, transparent, intervalMs: seconds * 1000, theme };
}

/** A fase mostrada: a pedida (se existir) ou a atual — a primeira não concluída, ou a última. */
export function pickStage(stages: readonly Stage[], requested: string | null): Stage | undefined {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  if (requested) {
    const found = ordered.find((s) => s.id === requested);
    if (found) return found;
  }
  return ordered.find((s) => s.status !== 'COMPLETED') ?? ordered.at(-1);
}

/** Endereço do telão para uma fase (usado no link da organização). */
export function telaoHref(slug: string, view: TelaoView, opts: { stageId?: string; transparent?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (opts.stageId) query.set('fase', opts.stageId);
  if (opts.transparent) query.set('fundo', 'transparente');
  const qs = query.toString();
  return `/c/${encodeURIComponent(slug)}/telao/${view}${qs ? `?${qs}` : ''}`;
}

/** Próxima página da rotação (volta ao início no fim). */
export function nextIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index + 1) % count;
}

export function previousIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index - 1 + count) % count;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const partLabel = (label: string, part: number, parts: number) => (parts > 1 ? `${label} · parte ${part} de ${parts}` : label);

export interface StandingsPage {
  key: string;
  label: string;
  rows: StandingRow[];
}

/**
 * Páginas da classificação: uma por grupo (ou a tabela geral), quebrando tabelas longas em partes de
 * `ROWS_PER_PAGE` linhas. A chave da página é estável entre atualizações, para a animação de posição.
 */
export function standingsPages(standings: Pick<Standings, 'groups' | 'overall'>, rowsPerPage = ROWS_PER_PAGE): StandingsPage[] {
  const groups = standings.groups.length > 0 ? standings.groups : [{ groupId: null, name: 'Classificação', rows: standings.overall }];
  const pages: StandingsPage[] = [];
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    const parts = chunk(group.rows, rowsPerPage);
    const name = groups.length > 1 ? group.name : 'Classificação geral';
    parts.forEach((rows, i) => pages.push({ key: `${group.groupId ?? 'geral'}-${i}`, label: partLabel(name, i + 1, parts.length), rows }));
  }
  return pages;
}

export interface BracketColumn {
  key: string;
  label: string;
  matches: Match[];
}

export interface BracketPage {
  key: string;
  label: string;
  columns: BracketColumn[];
}

/**
 * Páginas da chave.
 * - Eliminatória: cada lado (vencedores, perdedores, final) em janelas de até `ROUNDS_PER_PAGE` rodadas
 *   lado a lado; rodada com mais de `MATCHES_PER_COLUMN` confrontos vira colunas em partes.
 * - Grupos, pontos corridos, suíço e Battle Royale: a rodada em andamento (ou a última), uma página por
 *   grupo/sala, em partes de `MATCHES_PER_PAGE` confrontos.
 */
export function bracketPages(bracket: Pick<Bracket, 'format' | 'matches'>): BracketPage[] {
  if (isEliminationFormat(bracket.format)) {
    const pages: BracketPage[] = [];
    for (const side of bracketSides(bracket.matches)) {
      // Rodadas grandes (ex.: 32 avos) viram colunas em partes; as pequenas ficam juntas na mesma janela.
      const columns: BracketColumn[] = side.rounds.flatMap((round) => {
        const parts = chunk(round.matches, MATCHES_PER_COLUMN);
        return parts.map((matches, i) => ({ key: `${side.side}-${round.key}-${i}`, label: partLabel(round.label, i + 1, parts.length), matches }));
      });
      const windows = chunk(columns, ROUNDS_PER_PAGE);
      const sideLabel = bracketSides(bracket.matches).length > 1 ? `${side.label} · ` : '';
      windows.forEach((cols, i) => {
        const first = cols[0]?.label ?? '';
        const last = cols.at(-1)?.label ?? '';
        pages.push({ key: `${side.side}-${i}`, label: `${sideLabel}${first === last ? first : `${first} → ${last}`}`, columns: cols });
      });
    }
    return pages;
  }

  const rounds = stageRounds(bracket.matches);
  const currentKey = defaultRound(rounds);
  const round = rounds.find((r) => r.key === currentKey);
  if (!round) return [];
  const pages: BracketPage[] = [];
  for (const section of round.sections) {
    const parts = chunk(section.matches, MATCHES_PER_PAGE);
    const name = section.name ? `${round.label} · ${section.name}` : round.label;
    parts.forEach((matches, i) => pages.push({ key: `${round.key}-${section.key}-${i}`, label: partLabel(name, i + 1, parts.length), columns: [{ key: `${section.key}-${i}`, label: name, matches }] }));
  }
  return pages;
}
