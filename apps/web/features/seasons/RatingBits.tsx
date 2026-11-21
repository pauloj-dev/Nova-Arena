'use client';

/** Peças pequenas do rating (issue #120): variação com ícone + texto e o gráfico da evolução. */
import type { RatingHistoryPoint } from '@nova/schemas';
import { Badge } from '@nova/ui';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { formatDate } from '@/shared/lib/datetime';

/** "+12", "−8" ou "0" (sinal de menos tipográfico). */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

/** Variação de rating numa partida: ícone e texto (nunca só cor). */
export function RatingDelta({ delta }: { delta: number }) {
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone = delta > 0 ? 'text-primary-text' : delta < 0 ? 'text-danger' : 'text-muted';
  const label = delta > 0 ? `subiu ${delta} pontos de rating` : delta < 0 ? `caiu ${Math.abs(delta)} pontos de rating` : 'rating sem variação';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone}`}>
      <Icon className="size-3.5" aria-hidden />
      <span aria-hidden className="tabular">
        {formatDelta(delta)}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function ProvisionalBadge({ matches }: { matches: number }) {
  return (
    <Badge tone="warning" title={`O rating fica provisório nas primeiras ${matches} partidas da temporada.`}>
      Provisório
    </Badge>
  );
}

/**
 * Evolução do rating (linha). Decorativo para o leitor de tela: a mesma informação vai em texto ao lado
 * (rating atual, pico e a lista das últimas partidas no `<details>`).
 */
export function RatingSparkline({ history, initial, className }: { history: RatingHistoryPoint[]; initial: number; className?: string }) {
  const points = [initial, ...history.map((h) => h.rating)];
  const width = 240;
  const height = 64;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1);
  const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / span);
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const baseline = y(initial);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="presentation" aria-hidden focusable="false" preserveAspectRatio="none">
      <line x1={pad} x2={width - pad} y1={baseline} y2={baseline} className="stroke-border" strokeDasharray="4 4" strokeWidth={1} />
      <path d={path} className="fill-none stroke-accent" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1] as number)} r={3.5} className="fill-accent" />
    </svg>
  );
}

/** Lista das últimas variações, em texto (alternativa acessível ao gráfico). */
export function RatingHistoryList({ history }: { history: RatingHistoryPoint[] }) {
  const recent = [...history].reverse().slice(0, 10);
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {recent.map((h, i) => (
        <li key={`${h.at}-${i}`} className="flex items-center justify-between gap-3">
          <span className="text-muted">{formatDate(h.at)}</span>
          <span className="flex items-center gap-2">
            <RatingDelta delta={h.delta} />
            <span className="tabular font-semibold">{h.rating}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
