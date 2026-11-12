/**
 * Filtros da lista de campeonatos ↔ URL (US-PAR-02: o link filtrado reproduz a lista).
 * Os nomes dos parâmetros são os mesmos da API (`TournamentListQuery`), para o link ser previsível.
 */
import type { TournamentFilters } from '@/shared/api/hooks/tournaments';

export type ModeFilter = '' | 'SOLO' | 'TEAM';
export type StatusFilter = '' | 'open' | 'upcoming' | 'live' | 'finished';

export interface ListFilters {
  /** Busca por nome. */
  q: string;
  /** Slug do jogo. */
  game: string;
  mode: ModeFilter;
  status: StatusFilter;
  /** Data mínima de início, `AAAA-MM-DD`. */
  from: string;
  /** Só campeonatos com inscrições abertas e vaga livre. */
  slots: boolean;
  /** Só organizador verificado. */
  verified: boolean;
}

export const EMPTY_FILTERS: ListFilters = { q: '', game: '', mode: '', status: '', from: '', slots: false, verified: false };

export const MODE_OPTIONS: { value: Exclude<ModeFilter, ''>; label: string }[] = [
  { value: 'SOLO', label: 'Solo' },
  { value: 'TEAM', label: 'Equipe' },
];

export const STATUS_OPTIONS: { value: Exclude<StatusFilter, ''>; label: string }[] = [
  { value: 'open', label: 'Inscrições abertas' },
  { value: 'upcoming', label: 'Em breve' },
  { value: 'live', label: 'Ao vivo' },
  { value: 'finished', label: 'Encerrados' },
];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUERY_LENGTH = 80;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

interface ParamsLike {
  get(name: string): string | null;
}

/** Lê os filtros da URL. Valor desconhecido ou malformado é ignorado (o link nunca quebra a página). */
export function parseFilters(params: ParamsLike): ListFilters {
  const mode = (params.get('mode') ?? '').toUpperCase();
  const status = (params.get('status') ?? '').toLowerCase();
  const game = (params.get('game') ?? '').toLowerCase();
  const from = params.get('from') ?? '';
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    game: SLUG.test(game) ? game : '',
    mode: mode === 'SOLO' || mode === 'TEAM' ? mode : '',
    status: STATUS_OPTIONS.some((s) => s.value === status) ? (status as StatusFilter) : '',
    from: isRealDate(from) ? from : '',
    slots: params.get('slots') === 'available',
    verified: params.get('verified') === '1',
  };
}

/** Escreve os filtros na URL, sempre na mesma ordem e sem os que estão no valor padrão. */
export function serializeFilters(filters: ListFilters): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q) params.set('q', q);
  if (filters.game) params.set('game', filters.game);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.slots) params.set('slots', 'available');
  if (filters.verified) params.set('verified', '1');
  return params.toString();
}

/** Caminho da lista com os filtros aplicados. */
export function listHref(filters: Partial<ListFilters> = {}): string {
  const qs = serializeFilters({ ...EMPTY_FILTERS, ...filters });
  return qs ? `/campeonatos?${qs}` : '/campeonatos';
}

/** Filtros no formato que a API espera (sem os vazios, para a chave de cache ser estável). */
export function toApiFilters(filters: ListFilters): TournamentFilters {
  const api: TournamentFilters = {};
  const q = filters.q.trim();
  if (q) api.q = q;
  if (filters.game) api.game = filters.game;
  if (filters.mode) api.mode = filters.mode;
  if (filters.status) api.status = filters.status;
  if (filters.from) api.from = filters.from;
  if (filters.slots) api.slots = 'available';
  if (filters.verified) api.verified = '1';
  return api;
}

/** Quantos filtros estão ligados (a busca por nome não conta: ela tem o próprio campo, sempre visível). */
export function countActiveFilters(filters: ListFilters): number {
  return [filters.game, filters.mode, filters.status, filters.from, filters.slots, filters.verified].filter(Boolean).length;
}

export function hasAnyFilter(filters: ListFilters): boolean {
  return countActiveFilters(filters) > 0 || filters.q.trim() !== '';
}
