'use client';

import type { AdminStats } from '@nova/schemas';
import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDayLong, formatDayShort, formatNumber } from '../common/format';

/**
 * Gráficos do dashboard (Recharts). Série única em cada um: a cor é a do acento da área, vinda dos
 * tokens (`var(--accent)`), então muda sozinha entre tema claro e escuro. Eixos e grade ficam discretos.
 * Cada gráfico é acompanhado de uma tabela com os mesmos números (`ChartCard`).
 */
const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };
const TOOLTIP_STYLE = { background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', color: 'var(--text)', fontSize: 13, boxShadow: 'var(--shadow-md)' };
const TOOLTIP_LABEL_STYLE = { color: 'var(--text-muted)', fontWeight: 600 };
const TOOLTIP_ITEM_STYLE = { color: 'var(--text)' };
const HEIGHT = 240;

type DailyPoint = AdminStats['signups'][number];

function Frame({ label, children }: { label: string; children: ReactNode }) {
  // `role="img"` + rótulo: para leitor de tela o gráfico é uma imagem descrita; os números estão na tabela ao lado.
  return (
    <div role="img" aria-label={label} className="h-60 w-full min-w-0">
      {children}
    </div>
  );
}

/** Intervalo dos rótulos do eixo X para caber em qualquer largura (cerca de 6 rótulos). */
function tickInterval(points: number): number {
  return Math.max(0, Math.ceil(points / 6) - 1);
}

export function DailyAreaChart({ data, seriesName, label }: { data: DailyPoint[]; seriesName: string; label: string }) {
  return (
    <Frame label={label}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDayShort} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border-strong)' }} interval={tickInterval(data.length)} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(value) => [formatNumber(Number(value)), seriesName]}
            labelFormatter={(date) => formatDayLong(String(date))}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ stroke: 'var(--border-strong)' }}
          />
          <Area type="monotone" dataKey="count" name={seriesName} stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.14} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function DailyBarChart({ data, seriesName, label }: { data: DailyPoint[]; seriesName: string; label: string }) {
  return (
    <Frame label={label}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="20%">
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDayShort} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border-strong)' }} interval={tickInterval(data.length)} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(value) => [formatNumber(Number(value)), seriesName]}
            labelFormatter={(date) => formatDayLong(String(date))}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            cursor={{ fill: 'var(--neutral-soft)' }}
          />
          <Bar dataKey="count" name={seriesName} fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function GameBarChart({ data, label }: { data: AdminStats['tournamentsByGame']; label: string }) {
  return (
    <Frame label={label}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, bottom: 0, left: 8 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="gameName" tick={{ ...AXIS_TICK, fill: 'var(--text)' }} tickLine={false} axisLine={{ stroke: 'var(--border-strong)' }} width={96} />
          <Tooltip formatter={(value) => [formatNumber(Number(value)), 'Campeonatos']} contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ fill: 'var(--neutral-soft)' }} />
          <Bar dataKey="count" name="Campeonatos" fill="var(--accent)" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false} label={{ position: 'right', fill: 'var(--text)', fontSize: 12 }} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}
