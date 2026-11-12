'use client';

import type { Match, Stage, Tournament } from '@nova/schemas';
import { Badge, cn, EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { EyeOff, GitBranch, ShieldCheck, Trophy } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { BracketView } from '@/features/brackets/BracketView';
import { isEliminationFormat } from '@/features/brackets/rounds';
import { RoundsView } from '@/features/brackets/RoundsView';
import { StageStandings } from '@/features/brackets/StageStandings';
import { MatchDetailModal } from '@/features/matches/MatchDetailModal';
import { MatchesList } from '@/features/matches/MatchesList';
import { MatchCard } from '@/features/matches/MatchCard';
import { isConcluded } from '@/features/matches/matchText';
import { Podium } from '@/features/matches/Podium';
import { useMatchViewer } from '@/features/matches/viewer';
import { errorMessage } from '@/shared/api/client';
import { useBracket, usePodium, useStandings } from '@/shared/api/hooks/competition';
import { STAGE_FORMAT_LABELS } from './stageText';

/** O que as abas de competição recebem da página: a consulta de partidas é uma só para as três. */
export interface MatchesQuery {
  data: Match[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function BlockSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Atualiza um parâmetro da URL sem sair da página nem rolar. */
function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const set = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(name);
    else params.set(name, value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [searchParams.get(name), set];
}

/** A fase que abre primeiro: a que está em andamento; senão, a última já jogada; senão, a primeira. */
export function defaultStage(stages: readonly Stage[]): Stage | undefined {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  return ordered.find((s) => s.status === 'ACTIVE') ?? [...ordered].reverse().find((s) => s.status === 'COMPLETED') ?? ordered[0];
}

// ── Chave / Tabela ───────────────────────────────────────────────────

function StageContent({ tournament: t, stage }: { tournament: Tournament; stage: Stage }) {
  const viewer = useMatchViewer();
  const bracket = useBracket(stage.id);
  const standings = useStandings(stage.id);
  const me = viewer.registration?.id ?? null;
  const elimination = isEliminationFormat(stage.format);
  const participantHeader = t.participantType === 'SOLO' ? 'Jogador' : elimination || stage.format === 'ROUND_ROBIN' || stage.format === 'SWISS' ? 'Equipe' : 'Squad';

  if (bracket.isPending) return <BlockSkeleton label="Carregando a chave" />;
  if (bracket.isError) return <ErrorState title="Não foi possível carregar a chave" description={errorMessage(bracket.error)} onRetry={() => void bracket.refetch()} />;

  if (bracket.data.state === 'NONE') {
    const previous = t.stages.find((s) => s.order === stage.order - 1);
    return (
      <EmptyState
        icon={<GitBranch className="size-7" />}
        title="A chave desta fase ainda não foi gerada"
        description={
          previous && previous.status !== 'COMPLETED'
            ? `Ela sai quando a fase "${previous.name}" terminar e a organização confirmar quem avança. Siga o campeonato para ser avisado.`
            : 'A organização ainda vai gerar e confirmar a chave. Siga o campeonato para ser avisado quando ela sair.'
        }
      />
    );
  }

  const standingsBlock = standings.isPending ? (
    <BlockSkeleton label="Carregando a classificação" rows={4} />
  ) : standings.isError ? (
    <ErrorState title="Não foi possível carregar a classificação" description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} />
  ) : standings.data.overall.length === 0 ? (
    <p className="text-sm text-muted">A classificação aparece aqui depois do primeiro resultado.</p>
  ) : (
    <StageStandings standings={standings.data} participantHeader={participantHeader} highlightRegistrationId={me} />
  );

  const meta = (
    <div className="flex flex-col gap-2">
      {bracket.data.state === 'PREVIEW' && (
        <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-sm text-warning-soft-text">
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Esta chave é uma prévia: só a organização vê. Os participantes só enxergam depois que ela for confirmada.
        </p>
      )}
      {bracket.data.seeding === 'RANDOM' && bracket.data.seedUsed && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            Chave definida por sorteio. Seed do sorteio: <code className="tabular break-all text-text">{bracket.data.seedUsed}</code>
          </span>
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {meta}
      {elimination ? (
        <>
          <Section title="Chave">
            <BracketView bracket={bracket.data} highlightRegistrationId={me} />
          </Section>
          <Section title="Classificação">{standingsBlock}</Section>
        </>
      ) : (
        <>
          <Section title="Classificação">{standingsBlock}</Section>
          <Section title={stage.format === 'BATTLE_ROYALE' || (stage.format === 'GROUPS' && stage.config.groupMode === 'BATTLE_ROYALE') ? 'Quedas' : 'Rodadas'}>
            <RoundsView bracket={bracket.data} highlightRegistrationId={me} />
          </Section>
        </>
      )}
    </div>
  );
}

export function BracketTab({ tournament: t }: { tournament: Tournament }) {
  const [param, setParam] = useUrlParam('fase');
  const stages = [...t.stages].sort((a, b) => a.order - b.order);
  const stage = stages.find((s) => s.id === param) ?? defaultStage(stages);

  if (!stage) return <EmptyState icon={<GitBranch className="size-7" />} title="Este campeonato ainda não tem fases" description="A organização ainda não divulgou o formato." />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg">
          {isEliminationFormat(stage.format) ? 'Chave e classificação' : 'Tabela e partidas'}
          <span className="sr-only"> da fase {stage.name}</span>
        </h2>
        {stages.length > 1 ? (
          <div role="group" aria-label="Fase" className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === stage.id}
                onClick={() => setParam(s.id)}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors',
                  s.id === stage.id ? 'border-accent bg-accent-soft text-accent-soft-text' : 'border-border-strong bg-surface text-text hover:bg-surface-2',
                )}
              >
                <span className="tabular text-xs">{s.order}</span>
                {s.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {stage.name}
            {stage.name.trim().toLowerCase() !== STAGE_FORMAT_LABELS[stage.format].toLowerCase() && <Badge tone="neutral">{STAGE_FORMAT_LABELS[stage.format]}</Badge>}
          </p>
        )}
      </div>
      {/* `key`: trocar de fase recomeça o estado interno (aba da rodada, zoom) do zero. */}
      <StageContent key={stage.id} tournament={t} stage={stage} />
    </div>
  );
}

// ── Partidas ─────────────────────────────────────────────────────────

export function MatchesTab({ tournament: t, matches }: { tournament: Tournament; matches: MatchesQuery }) {
  const [openId, setOpenId] = useUrlParam('partida');

  if (matches.isPending) return <BlockSkeleton label="Carregando as partidas" rows={4} />;
  if (matches.isError || !matches.data) return <ErrorState title="Não foi possível carregar as partidas" description={errorMessage(matches.error)} onRetry={() => void matches.refetch()} />;

  const open = openId ? (matches.data.find((m) => m.id === openId) ?? null) : null;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg">Partidas</h2>
      <MatchesList matches={matches.data} stages={[...t.stages].sort((a, b) => a.order - b.order).map((s) => ({ id: s.id, name: s.name }))} onOpen={(m) => setOpenId(m.id)} />
      <MatchDetailModal match={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ── Resultados ───────────────────────────────────────────────────────

export function ResultsTab({ tournament: t, matches }: { tournament: Tournament; matches: MatchesQuery }) {
  const viewer = useMatchViewer();
  const podium = usePodium(t.id);
  const [openId, setOpenId] = useState<string | null>(null);

  if (matches.isPending) return <BlockSkeleton label="Carregando os resultados" rows={4} />;
  if (matches.isError || !matches.data) return <ErrorState title="Não foi possível carregar os resultados" description={errorMessage(matches.error)} onRetry={() => void matches.refetch()} />;

  const recency = (m: Match) => m.updatedAt ?? m.scheduledAt ?? '';
  // Bye não é resultado: só entra partida com dois lados (ou a queda inteira).
  const concluded = matches.data.filter((m) => isConcluded(m) && m.participants.every((p) => p.registrationId !== null)).sort((a, b) => recency(b).localeCompare(recency(a)));
  const open = openId ? (matches.data.find((m) => m.id === openId) ?? null) : null;

  return (
    <div className="flex flex-col gap-8">
      <h2 className="sr-only">Resultados</h2>
      {podium.data && <Podium podium={podium.data} highlightRegistrationId={viewer.registration?.id} />}
      {t.status === 'FINISHED' && podium.isSuccess && !podium.data && <p className="text-sm text-muted">O campeonato terminou, mas a organização ainda não publicou o pódio.</p>}
      <Section title="Partidas concluídas" aside={<span className="tabular text-sm text-muted">{concluded.length}</span>}>
        {concluded.length === 0 ? (
          <EmptyState icon={<Trophy className="size-7" />} title="Nenhum resultado ainda" description="Assim que a primeira partida terminar, o resultado aparece aqui." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Partidas concluídas, da mais recente para a mais antiga">
            {concluded.map((match) => (
              <li key={match.id}>
                <MatchCard match={match} variant="compact" onOpen={(m) => setOpenId(m.id)} headingLevel={4} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <MatchDetailModal match={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
