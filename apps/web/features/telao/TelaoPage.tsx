'use client';

import type { Bracket, Stage, Standings } from '@nova/schemas';
import { EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { ListOrdered, Network } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useBracket, useStandings } from '@/shared/api/hooks/competition';
import { useTournament } from '@/shared/api/hooks/tournaments';
import { useTournamentChannel } from '@/shared/realtime/RealtimeProvider';
import { useRotation, useTelaoEnvironment } from './hooks';
import { bracketPages, parseTelaoOptions, pickStage, standingsPages, type TelaoView } from './telao';
import { TelaoBracket } from './TelaoBracket';
import { TelaoShell } from './TelaoShell';
import { TelaoStandings } from './TelaoStandings';

const VIEW_LABEL: Record<TelaoView, string> = { tabela: 'Classificação', chave: 'Chave' };

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
  const pages = useMemo(() => standingsPages(standings), [standings]);
  const rotation = useRotation(pages.length, intervalMs);
  const page = pages[rotation.index];
  return (
    <TelaoShell transparent={transparent} title={tournamentName} subtitle={`${stageName} · Classificação`} pageLabel={page?.label} pageCount={pages.length} rotation={rotation}>
      {page ? (
        <div key={page.key} className="motion-safe:animate-fade-in">
          <TelaoStandings page={page} matchType={standings.matchType} transparent={transparent} />
        </div>
      ) : (
        <EmptyState icon={<ListOrdered className="size-7" />} title="A classificação ainda está vazia" description="Ela aparece aqui assim que a primeira partida desta fase tiver resultado." />
      )}
    </TelaoShell>
  );
}

function BracketContent({ bracket, transparent, intervalMs, stageName, tournamentName }: { bracket: Bracket; transparent: boolean; intervalMs: number; stageName: string; tournamentName: string }) {
  const pages = useMemo(() => bracketPages(bracket), [bracket]);
  const rotation = useRotation(pages.length, intervalMs);
  const page = pages[rotation.index];
  return (
    <TelaoShell transparent={transparent} title={tournamentName} subtitle={`${stageName} · Chave`} pageLabel={page?.label} pageCount={pages.length} rotation={rotation}>
      {page ? (
        <div key={page.key} className="flex min-h-0 flex-1 flex-col motion-safe:animate-fade-in">
          <TelaoBracket page={page} transparent={transparent} />
        </div>
      ) : (
        <EmptyState icon={<Network className="size-7" />} title="Nenhum confronto nesta fase" description="Os confrontos aparecem aqui quando a chave for gerada." />
      )}
    </TelaoShell>
  );
}

function StageScreen({ view, stage, tournamentName, transparent, intervalMs }: { view: TelaoView; stage: Stage; tournamentName: string; transparent: boolean; intervalMs: number }) {
  const bracket = useBracket(stage.id);
  const confirmed = bracket.data?.state === 'CONFIRMED';
  const standings = useStandings(view === 'tabela' && confirmed ? stage.id : undefined);
  const shell = (children: ReactNode) => (
    <TelaoShell transparent={transparent} title={tournamentName} subtitle={`${stage.name} · ${VIEW_LABEL[view]}`}>
      {children}
    </TelaoShell>
  );

  if (bracket.isPending) return shell(<Loading label={`Carregando ${VIEW_LABEL[view].toLowerCase()}`} />);
  if (bracket.isError) return shell(<ErrorState title="Não foi possível carregar a fase" description={errorMessage(bracket.error)} onRetry={() => void bracket.refetch()} />);
  if (!confirmed) {
    return shell(
      <EmptyState
        icon={view === 'tabela' ? <ListOrdered className="size-7" /> : <Network className="size-7" />}
        title="A chave desta fase ainda não foi divulgada"
        description="O telão começa a mostrar os dados assim que a organização confirmar a chave. Esta tela se atualiza sozinha."
      />,
    );
  }
  if (view === 'chave') return <BracketContent bracket={bracket.data} transparent={transparent} intervalMs={intervalMs} stageName={stage.name} tournamentName={tournamentName} />;
  if (standings.isPending) return shell(<Loading label="Carregando classificação" />);
  if (standings.isError) return shell(<ErrorState title="Não foi possível carregar a classificação" description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} />);
  return <StandingsContent standings={standings.data} transparent={transparent} intervalMs={intervalMs} stageName={stage.name} tournamentName={tournamentName} />;
}

/**
 * Modo telão (issue #124): classificação ou chave de uma fase em tela cheia, para transmitir no OBS.
 * `?fase=` escolhe a fase (padrão: a atual), `?fundo=transparente` tira o fundo, `?intervalo=` muda o tempo
 * de cada página da rotação (segundos) e `?tema=claro` troca o tema (padrão escuro). Atualiza pelo tempo
 * real; se a conexão cair, as consultas passam a atualizar a cada 10 s.
 */
export function TelaoPage({ slug, view }: { slug: string; view: TelaoView }) {
  const params = useSearchParams();
  const options = useMemo(() => parseTelaoOptions(params), [params]);
  useTelaoEnvironment(options.transparent, options.theme);
  const tournament = useTournament(slug);
  useTournamentChannel(tournament.data?.id);

  if (tournament.isPending) {
    return (
      <TelaoShell transparent={options.transparent} title="Carregando campeonato…">
        <Loading label="Carregando campeonato" />
      </TelaoShell>
    );
  }
  if (tournament.isError) {
    return (
      <TelaoShell transparent={options.transparent} title="Telão">
        <ErrorState title="Não foi possível carregar o campeonato" description={errorMessage(tournament.error)} onRetry={() => void tournament.refetch()} />
      </TelaoShell>
    );
  }
  const stage = pickStage(tournament.data.stages, options.stageId);
  if (!stage) {
    return (
      <TelaoShell transparent={options.transparent} title={tournament.data.name}>
        <EmptyState icon={<Network className="size-7" />} title="Este campeonato ainda não tem fases" description="O telão mostra a classificação e a chave depois que a organização montar as fases." />
      </TelaoShell>
    );
  }
  return <StageScreen key={stage.id} view={view} stage={stage} tournamentName={tournament.data.name} transparent={options.transparent} intervalMs={options.intervalMs} />;
}
