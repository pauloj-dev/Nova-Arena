'use client';

import type { Bracket, Stage, Standings } from '@nova/schemas';
import { EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { ListOrdered, Network } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useBracket, useStandings } from '@/shared/api/hooks/competition';
import { useTournament } from '@/shared/api/hooks/tournaments';
import { useT } from '@/shared/i18n/react';
import { useTournamentChannel } from '@/shared/realtime/RealtimeProvider';
import { useRotation, useTelaoEnvironment } from './hooks';
import { messages } from './messages';
import { bracketPages, parseTelaoOptions, pickStage, standingsPages, type TelaoView } from './telao';
import { TelaoBracket } from './TelaoBracket';
import { TelaoShell } from './TelaoShell';
import { TelaoStandings } from './TelaoStandings';

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function StandingsContent({ standings, transparent, intervalMs, stageName, tournamentName }: { standings: Standings; transparent: boolean; intervalMs: number; stageName: string; tournamentName: string }) {
  const t = useT(messages, 'TelaoPage');
  const pages = useMemo(() => standingsPages(standings), [standings]);
  const rotation = useRotation(pages.length, intervalMs);
  const page = pages[rotation.index];
  return (
    <TelaoShell transparent={transparent} title={tournamentName} subtitle={t('subtitulo', { stage: stageName, view: 'tabela' })} pageLabel={page?.label} pageCount={pages.length} rotation={rotation}>
      {page ? (
        <div key={page.key} className="motion-safe:animate-fade-in">
          <TelaoStandings page={page} matchType={standings.matchType} transparent={transparent} />
        </div>
      ) : (
        <EmptyState icon={<ListOrdered className="size-7" />} title={t('classificacaoVaziaTitulo')} description={t('classificacaoVaziaDescricao')} />
      )}
    </TelaoShell>
  );
}

function BracketContent({ bracket, transparent, intervalMs, stageName, tournamentName }: { bracket: Bracket; transparent: boolean; intervalMs: number; stageName: string; tournamentName: string }) {
  const t = useT(messages, 'TelaoPage');
  const pages = useMemo(() => bracketPages(bracket), [bracket]);
  const rotation = useRotation(pages.length, intervalMs);
  const page = pages[rotation.index];
  return (
    <TelaoShell transparent={transparent} title={tournamentName} subtitle={t('subtitulo', { stage: stageName, view: 'chave' })} pageLabel={page?.label} pageCount={pages.length} rotation={rotation}>
      {page ? (
        <div key={page.key} className="flex min-h-0 flex-1 flex-col motion-safe:animate-fade-in">
          <TelaoBracket page={page} transparent={transparent} />
        </div>
      ) : (
        <EmptyState icon={<Network className="size-7" />} title={t('chaveVaziaTitulo')} description={t('chaveVaziaDescricao')} />
      )}
    </TelaoShell>
  );
}

function StageScreen({ view, stage, tournamentName, transparent, intervalMs }: { view: TelaoView; stage: Stage; tournamentName: string; transparent: boolean; intervalMs: number }) {
  const t = useT(messages, 'TelaoPage');
  const bracket = useBracket(stage.id);
  const confirmed = bracket.data?.state === 'CONFIRMED';
  const standings = useStandings(view === 'tabela' && confirmed ? stage.id : undefined);
  const shell = (children: ReactNode) => (
    <TelaoShell transparent={transparent} title={tournamentName} subtitle={t('subtitulo', { stage: stage.name, view })}>
      {children}
    </TelaoShell>
  );

  if (bracket.isPending) return shell(<Loading label={t('carregando', { view })} />);
  if (bracket.isError) return shell(<ErrorState title={t('erroFase')} description={errorMessage(bracket.error)} onRetry={() => void bracket.refetch()} />);
  if (!confirmed) {
    return shell(
      <EmptyState
        icon={view === 'tabela' ? <ListOrdered className="size-7" /> : <Network className="size-7" />}
        title={t('naoDivulgadaTitulo')}
        description={t('naoDivulgadaDescricao')}
      />,
    );
  }
  if (view === 'chave') return <BracketContent bracket={bracket.data} transparent={transparent} intervalMs={intervalMs} stageName={stage.name} tournamentName={tournamentName} />;
  if (standings.isPending) return shell(<Loading label={t('carregando', { view: 'tabela' })} />);
  if (standings.isError) return shell(<ErrorState title={t('erroClassificacao')} description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} />);
  return <StandingsContent standings={standings.data} transparent={transparent} intervalMs={intervalMs} stageName={stage.name} tournamentName={tournamentName} />;
}

/**
 * Modo telão (issue #124): classificação ou chave de uma fase em tela cheia, para transmitir no OBS.
 * `?fase=` escolhe a fase (padrão: a atual), `?fundo=transparente` tira o fundo, `?intervalo=` muda o tempo
 * de cada página da rotação (segundos) e `?tema=claro` troca o tema (padrão escuro). Atualiza pelo tempo
 * real; se a conexão cair, as consultas passam a atualizar a cada 10 s.
 */
export function TelaoPage({ slug, view }: { slug: string; view: TelaoView }) {
  const t = useT(messages, 'TelaoPage');
  const params = useSearchParams();
  const options = useMemo(() => parseTelaoOptions(params), [params]);
  useTelaoEnvironment(options.transparent, options.theme);
  const tournament = useTournament(slug);
  useTournamentChannel(tournament.data?.id);

  if (tournament.isPending) {
    return (
      <TelaoShell transparent={options.transparent} title={t('carregandoCampeonatoTitulo')}>
        <Loading label={t('carregandoCampeonato')} />
      </TelaoShell>
    );
  }
  if (tournament.isError) {
    return (
      <TelaoShell transparent={options.transparent} title={t('telao')}>
        <ErrorState title={t('erroCampeonato')} description={errorMessage(tournament.error)} onRetry={() => void tournament.refetch()} />
      </TelaoShell>
    );
  }
  const stage = pickStage(tournament.data.stages, options.stageId);
  if (!stage) {
    return (
      <TelaoShell transparent={options.transparent} title={tournament.data.name}>
        <EmptyState icon={<Network className="size-7" />} title={t('semFasesTitulo')} description={t('semFasesDescricao')} />
      </TelaoShell>
    );
  }
  return <StageScreen key={stage.id} view={view} stage={stage} tournamentName={tournament.data.name} transparent={options.transparent} intervalMs={options.intervalMs} />;
}
