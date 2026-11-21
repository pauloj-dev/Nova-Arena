/** Textos e conversões das ligas semanais (issue #120). */
import { SEASON_STATUS_LABELS, type League, type LeagueRule } from '@nova/schemas';
import type { BadgeTone } from '@nova/ui';
import { formatDate } from '@/shared/lib/datetime';

export const LEAGUE_STATUS: Record<League['status'], { label: string; tone: BadgeTone }> = {
  UPCOMING: { label: SEASON_STATUS_LABELS.UPCOMING, tone: 'info' },
  ACTIVE: { label: SEASON_STATUS_LABELS.ACTIVE, tone: 'primary' },
  ENDED: { label: SEASON_STATUS_LABELS.ENDED, tone: 'neutral' },
};

/** "25, 18, 15" → [25, 18, 15]. Texto inválido → `null`. Aceita vírgula, ponto e vírgula e espaços. */
export function parsePoints(text: string): number[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const values = parts.map((p) => (/^\d+$/.test(p) ? Number.parseInt(p, 10) : Number.NaN));
  return values.some((v) => Number.isNaN(v)) ? null : values;
}

export const pointsText = (points: readonly number[]) => points.join(', ');

/** "1º 25 · 2º 18 · 3º 15 … · +1 por participar". */
export function ruleSummary(rule: LeagueRule, max = 5): string {
  const shown = rule.placementPoints.slice(0, max).map((p, i) => `${i + 1}º ${p}`);
  const more = rule.placementPoints.length > max ? ' …' : '';
  const participation = rule.participationPoints > 0 ? ` · +${rule.participationPoints} por participar` : '';
  return `${shown.join(' · ')}${more}${participation}`;
}

/** Período da liga ou temporada (o fim guardado é exclusivo: mostra o dia anterior). */
export function periodText(startsAt: string, endsAt: string): string {
  return `${formatDate(startsAt)} a ${formatDate(new Date(new Date(endsAt).getTime() - 1).toISOString())}`;
}

export const placementText = (n: number) => `${n}º`;
