'use client';

import { Button, Card, cn, ErrorState } from '@nova/ui';
import { CheckCircle2, Flag, Gavel, Star, Swords, Target, Trophy, UserPlus, Users, UserX } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminStats } from '@/shared/api/hooks/admin';
import { useAuditLogs } from '@/shared/api/hooks/admin-audit';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { AuditTimeline } from '../audit/AuditTimeline';
import { formatDayLong, formatNumber, formatPercent, plural } from '../common/format';
import { ChartCard } from './ChartCard';
import { DailyAreaChart, DailyBarChart, GameBarChart } from './charts';
import { KpiCard } from './KpiCard';

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
  const [days, setDays] = useState<RangeDays>(30);
  const range = useMemo(() => rangeOf(days), [days]);
  const stats = useAdminStats(range);
  const recent = useAuditLogs({ page: 1 });
  const s = stats.data;
  const num = (value: number | undefined) => (value === undefined ? undefined : formatNumber(value));
  const period = `últimos ${days} dias`;

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Como a Nova Arena está agora: pessoas, campeonatos, partidas e o que espera uma decisão sua."
        actions={
          <div role="group" aria-label="Intervalo dos gráficos" className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={days === option}
                onClick={() => setDays(option)}
                className={cn('min-h-11 rounded-sm px-3 text-sm font-semibold text-muted hover:text-text md:min-h-9', days === option && 'bg-accent text-on-accent hover:text-on-accent')}
              >
                {option} dias
              </button>
            ))}
          </div>
        }
      />

      {stats.isError ? (
        <ErrorState description={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <section aria-label="Indicadores" className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Partidas validadas na semana"
              value={num(s?.validatedMatchesThisWeek)}
              hint={s ? `de ${plural(s.matchesThisWeek, 'partida', 'partidas')} na semana` : undefined}
              icon={Star}
              href="/admin/campeonatos"
              linkLabel="Ver campeonatos"
              highlight
            />
            <KpiCard label="Usuários ativos" value={num(s?.activeUsers)} hint={s ? `de ${plural(s.totalUsers, 'conta', 'contas')} · últimos 30 dias` : undefined} icon={Users} href="/admin/usuarios" linkLabel="Ver usuários" />
            <KpiCard
              label="Campeonatos ativos"
              value={num(s?.activeTournaments)}
              hint={s ? `${plural(s.finishedTournaments, 'encerrado', 'encerrados')}` : undefined}
              icon={Trophy}
              href="/admin/campeonatos"
              linkLabel="Ver campeonatos"
            />
            <KpiCard label="Partidas na semana" value={num(s?.matchesThisWeek)} hint="marcadas ou concluídas em 7 dias" icon={Swords} href="/admin/campeonatos" linkLabel="Ver campeonatos" />
            <KpiCard label="Disputas abertas" value={num(s?.openDisputes)} hint="resultados contestados" icon={Gavel} href="/admin/moderacao?aba=disputas" linkLabel="Abrir a moderação" attention={(s?.openDisputes ?? 0) > 0} />
            <KpiCard label="Denúncias abertas" value={num(s?.openReports)} hint="esperando análise" icon={Flag} href="/admin/moderacao" linkLabel="Abrir a moderação" attention={(s?.openReports ?? 0) > 0} />
            <KpiCard
              label="Pedidos de organizador"
              value={num(s?.pendingOrganizerRequests)}
              hint="na fila"
              icon={Target}
              href="/admin/organizadores?aba=pedidos"
              linkLabel="Ver a fila de pedidos"
              attention={(s?.pendingOrganizerRequests ?? 0) > 0}
            />
            <KpiCard label="Taxa de W.O." value={s ? formatPercent(s.walkoverRate) : undefined} hint={s ? `disputas: ${formatPercent(s.disputeRate)} das partidas · ${period}` : undefined} icon={UserX} href="/admin/auditoria" linkLabel="Ver a auditoria" />
          </section>
          <p className="-mt-3 text-xs text-muted">
            <CheckCircle2 className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />
            Partidas validadas na semana é o indicador principal da Nova Arena: mostra campeonatos acontecendo, gente comparecendo e resultado conferido.
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Novos cadastros"
              summary={s ? `${plural(sum(s.signups), 'cadastro', 'cadastros')} nos ${period}` : 'Carregando…'}
              chart={s && sum(s.signups) > 0 ? <DailyAreaChart data={s.signups} seriesName="Cadastros" label={`Gráfico de área: novos cadastros por dia nos ${period}. Total: ${sum(s.signups)}.`} /> : null}
              emptyText={s ? `Nenhum cadastro nos ${period}. Aumente o intervalo para ver mais.` : 'Carregando os cadastros…'}
              tableHead={['Dia', 'Cadastros']}
              tableRows={(s?.signups ?? []).map((p) => ({ label: formatDayLong(p.date), value: formatNumber(p.count) }))}
            />
            <ChartCard
              title="Partidas validadas"
              summary={s ? `${plural(sum(s.validatedMatches), 'partida validada', 'partidas validadas')} nos ${period}` : 'Carregando…'}
              chart={
                s && sum(s.validatedMatches) > 0 ? (
                  <DailyBarChart data={s.validatedMatches} seriesName="Partidas validadas" label={`Gráfico de barras: partidas com resultado validado por dia nos ${period}. Total: ${sum(s.validatedMatches)}.`} />
                ) : null
              }
              emptyText={s ? `Nenhuma partida validada nos ${period}.` : 'Carregando as partidas…'}
              tableHead={['Dia', 'Partidas validadas']}
              tableRows={(s?.validatedMatches ?? []).map((p) => ({ label: formatDayLong(p.date), value: formatNumber(p.count) }))}
            />
            <ChartCard
              title="Campeonatos por jogo"
              summary={s ? `${plural(sum(s.tournamentsByGame), 'campeonato publicado', 'campeonatos publicados')} até hoje, em ${plural(s.tournamentsByGame.length, 'jogo', 'jogos')}` : 'Carregando…'}
              chart={
                s && s.tournamentsByGame.length > 0 ? (
                  <GameBarChart data={s.tournamentsByGame} label={`Gráfico de barras: campeonatos por jogo. ${s.tournamentsByGame.map((g) => `${g.gameName}: ${g.count}`).join(', ')}.`} />
                ) : null
              }
              emptyText={s ? 'Nenhum campeonato publicado ainda.' : 'Carregando os campeonatos…'}
              tableHead={['Jogo', 'Campeonatos']}
              tableRows={(s?.tournamentsByGame ?? []).map((g) => ({ label: g.gameName, value: formatNumber(g.count) }))}
            />
            <Card>
              <section aria-labelledby="ultimas-acoes" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="ultimas-acoes" className="text-lg">
                    Últimas ações
                  </h2>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/admin/auditoria">Ver a auditoria</Link>
                  </Button>
                </div>
                {recent.isError ? (
                  <ErrorState description={errorMessage(recent.error)} onRetry={() => void recent.refetch()} />
                ) : (
                  <AuditTimeline
                    compact
                    label="Últimas ações registradas na auditoria"
                    loading={recent.isPending}
                    logs={recent.data?.items.slice(0, 6)}
                    empty={
                      <p className="flex items-start gap-2 rounded-md border border-dashed border-border-strong px-4 py-6 text-sm text-muted">
                        <UserPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
                        Nenhuma ação registrada ainda. Convites, sanções, trocas de responsável e mudanças de configuração aparecem aqui.
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
