'use client';

import { Button, Card, cn, ErrorState } from '@nova/ui';
import { CheckCircle2, Flag, Gavel, Star, Swords, Target, Trophy, UserPlus, Users, UserX } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminStats, useProductMetrics } from '@/shared/api/hooks/admin';
import { useAuditLogs } from '@/shared/api/hooks/admin-audit';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { AuditTimeline } from '../audit/AuditTimeline';
import { formatDayLong, formatNumber, formatPercent } from '../common/format';
import { ChartCard } from './ChartCard';
import { KpiCard } from './KpiCard';
import { adminDashboardMessages } from './messages';
import { ProductMetricsSection } from './ProductMetricsSection';

// Gráficos (recharts) só no navegador e depois do primeiro paint: fora do JS inicial do painel (#111).
const chartLoading = () => <div className="h-56 w-full animate-pulse rounded-md bg-surface-2" aria-hidden />;
const DailyAreaChart = dynamic(() => import('./charts').then((m) => m.DailyAreaChart), { ssr: false, loading: chartLoading });
const DailyBarChart = dynamic(() => import('./charts').then((m) => m.DailyBarChart), { ssr: false, loading: chartLoading });
const GameBarChart = dynamic(() => import('./charts').then((m) => m.GameBarChart), { ssr: false, loading: chartLoading });

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];
const DAY_MS = 24 * 3600_000;

/** Últimos N dias, contando hoje, em datas UTC (`AAAA-MM-DD`). */
function rangeOf(days: RangeDays): { from: string; to: string } {
  const now = Date.now();
  return { from: new Date(now - (days - 1) * DAY_MS).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10) };
}

const sum = (points: { count: number }[]) => points.reduce((total, p) => total + p.count, 0);

/** Dashboard do Admin (ADM-01, wireframe do PRD §15.6): indicadores, gráficos com intervalo e últimas ações. */
export function AdminDashboard() {
  const t = useT(adminDashboardMessages, 'AdminDashboard');
  const [days, setDays] = useState<RangeDays>(30);
  const range = useMemo(() => rangeOf(days), [days]);
  const stats = useAdminStats(range);
  const metrics = useProductMetrics(range);
  const recent = useAuditLogs({ page: 1 });
  const s = stats.data;
  const num = (value: number | undefined) => (value === undefined ? undefined : formatNumber(value));
  const dias = String(days);
  const gameChartLabel = s ? t('porJogo.grafico', { lista: s.tournamentsByGame.map((g) => t('porJogo.item', { jogo: g.gameName, n: String(g.count) })).join(', ') }) : '';

  return (
    <PageContainer>
      <PageHeader
        title={t('titulo')}
        description={t('descricao')}
        actions={
          <div role="group" aria-label={t('intervalo')} className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={days === option}
                onClick={() => setDays(option)}
                className={cn('min-h-11 rounded-sm px-3 text-sm font-semibold text-muted hover:text-text md:min-h-9', days === option && 'bg-accent text-on-accent hover:text-on-accent')}
              >
                {t('dias', { n: String(option) })}
              </button>
            ))}
          </div>
        }
      />

      {stats.isError ? (
        <ErrorState description={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <section aria-label={t('indicadores')} className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={t('validadasSemana')}
              value={num(s?.validatedMatchesThisWeek)}
              hint={s ? t('validadasSemanaDica', { count: s.matchesThisWeek }) : undefined}
              icon={Star}
              href="/admin/campeonatos"
              linkLabel={t('verCampeonatos')}
              highlight
            />
            <KpiCard label={t('usuariosAtivos')} value={num(s?.activeUsers)} hint={s ? t('usuariosAtivosDica', { count: s.totalUsers }) : undefined} icon={Users} href="/admin/usuarios" linkLabel={t('verUsuarios')} />
            <KpiCard
              label={t('campeonatosAtivos')}
              value={num(s?.activeTournaments)}
              hint={s ? t('campeonatosAtivosDica', { count: s.finishedTournaments }) : undefined}
              icon={Trophy}
              href="/admin/campeonatos"
              linkLabel={t('verCampeonatos')}
            />
            <KpiCard label={t('partidasSemana')} value={num(s?.matchesThisWeek)} hint={t('partidasSemanaDica')} icon={Swords} href="/admin/campeonatos" linkLabel={t('verCampeonatos')} />
            <KpiCard label={t('disputas')} value={num(s?.openDisputes)} hint={t('disputasDica')} icon={Gavel} href="/admin/moderacao?aba=disputas" linkLabel={t('abrirModeracao')} attention={(s?.openDisputes ?? 0) > 0} />
            <KpiCard label={t('denuncias')} value={num(s?.openReports)} hint={t('denunciasDica')} icon={Flag} href="/admin/moderacao" linkLabel={t('abrirModeracao')} attention={(s?.openReports ?? 0) > 0} />
            <KpiCard
              label={t('pedidos')}
              value={num(s?.pendingOrganizerRequests)}
              hint={t('pedidosDica')}
              icon={Target}
              href="/admin/organizadores?aba=pedidos"
              linkLabel={t('verPedidos')}
              attention={(s?.pendingOrganizerRequests ?? 0) > 0}
            />
            <KpiCard label={t('taxaWo')} value={s ? formatPercent(s.walkoverRate) : undefined} hint={s ? t('taxaWoDica', { taxa: formatPercent(s.disputeRate), dias }) : undefined} icon={UserX} href="/admin/auditoria" linkLabel={t('verAuditoria')} />
          </section>
          <p className="-mt-3 text-xs text-muted">
            <CheckCircle2 className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />
            {t('northStar')}
          </p>

          <ProductMetricsSection data={metrics.data} loading={metrics.isPending} failed={metrics.isError} onRetry={() => void metrics.refetch()} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title={t('cadastros.titulo')}
              summary={s ? t('cadastros.resumo', { count: sum(s.signups), dias }) : t('carregando')}
              chart={s && sum(s.signups) > 0 ? <DailyAreaChart data={s.signups} seriesName={t('cadastros.serie')} label={t('cadastros.grafico', { dias, total: String(sum(s.signups)) })} /> : null}
              emptyText={s ? t('cadastros.vazio', { dias }) : t('cadastros.carregando')}
              tableHead={[t('dia'), t('cadastros.serie')]}
              tableRows={(s?.signups ?? []).map((p) => ({ label: formatDayLong(p.date), value: formatNumber(p.count) }))}
            />
            <ChartCard
              title={t('validadas.titulo')}
              summary={s ? t('validadas.resumo', { count: sum(s.validatedMatches), dias }) : t('carregando')}
              chart={
                s && sum(s.validatedMatches) > 0 ? (
                  <DailyBarChart data={s.validatedMatches} seriesName={t('validadas.serie')} label={t('validadas.grafico', { dias, total: String(sum(s.validatedMatches)) })} />
                ) : null
              }
              emptyText={s ? t('validadas.vazio', { dias }) : t('validadas.carregando')}
              tableHead={[t('dia'), t('validadas.serie')]}
              tableRows={(s?.validatedMatches ?? []).map((p) => ({ label: formatDayLong(p.date), value: formatNumber(p.count) }))}
            />
            <ChartCard
              title={t('porJogo.titulo')}
              summary={s ? t('porJogo.resumo', { count: sum(s.tournamentsByGame), jogos: s.tournamentsByGame.length }) : t('carregando')}
              chart={
                s && s.tournamentsByGame.length > 0 ? (
                  <GameBarChart data={s.tournamentsByGame} label={gameChartLabel} />
                ) : null
              }
              emptyText={s ? t('porJogo.vazio') : t('porJogo.carregando')}
              tableHead={[t('porJogo.jogo'), t('porJogo.campeonatos')]}
              tableRows={(s?.tournamentsByGame ?? []).map((g) => ({ label: g.gameName, value: formatNumber(g.count) }))}
            />
            <Card>
              <section aria-labelledby="ultimas-acoes" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="ultimas-acoes" className="text-lg">
                    {t('ultimasAcoes')}
                  </h2>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/admin/auditoria">{t('verAuditoria')}</Link>
                  </Button>
                </div>
                {recent.isError ? (
                  <ErrorState description={errorMessage(recent.error)} onRetry={() => void recent.refetch()} />
                ) : (
                  <AuditTimeline
                    compact
                    label={t('ultimasAcoesRotulo')}
                    loading={recent.isPending}
                    logs={recent.data?.items.slice(0, 6)}
                    empty={
                      <p className="flex items-start gap-2 rounded-md border border-dashed border-border-strong px-4 py-6 text-sm text-muted">
                        <UserPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {t('nenhumaAcao')}
                      </p>
                    }
                  />
                )}
              </section>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  );
}
