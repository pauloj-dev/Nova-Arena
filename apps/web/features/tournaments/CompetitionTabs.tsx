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
import { CalendarExport } from '@/features/calendar/CalendarExport';
import { MatchesList } from '@/features/matches/MatchesList';
import { MatchCard } from '@/features/matches/MatchCard';
import { isConcluded } from '@/features/matches/matchText';
import { Podium } from '@/features/matches/Podium';
import { useMatchViewer } from '@/features/matches/viewer';
import { errorMessage } from '@/shared/api/client';
import { useBracket, usePodium, useStandings } from '@/shared/api/hooks/competition';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import { stageFormatLabel } from './stageText';

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

function StageContent({ tournament, stage }: { tournament: Tournament; stage: Stage }) {
  const t = useT(messages, 'CompetitionTabs');
  const viewer = useMatchViewer();
  const bracket = useBracket(stage.id);
  const standings = useStandings(stage.id);
  const me = viewer.registration?.id ?? null;
  const elimination = isEliminationFormat(stage.format);
  const participantHeader = tournament.participantType === 'SOLO' ? t('jogador') : elimination || stage.format === 'ROUND_ROBIN' || stage.format === 'SWISS' ? t('equipe') : t('squad');

  if (bracket.isPending) return <BlockSkeleton label={t('carregandoChave')} />;
  if (bracket.isError) return <ErrorState title={t('erroChave')} description={errorMessage(bracket.error)} onRetry={() => void bracket.refetch()} />;

  if (bracket.data.state === 'NONE') {
    const previous = tournament.stages.find((s) => s.order === stage.order - 1);
    return (
      <EmptyState
        icon={<GitBranch className="size-7" />}
        title={t('chaveNaoGerada')}
        description={previous && previous.status !== 'COMPLETED' ? t('chaveSaiDepoisDaFase', { fase: previous.name }) : t('chaveAindaVaiSair')}
      />
    );
  }

  const standingsBlock = standings.isPending ? (
    <BlockSkeleton label={t('carregandoClassificacao')} rows={4} />
  ) : standings.isError ? (
    <ErrorState title={t('erroClassificacao')} description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} />
  ) : standings.data.overall.length === 0 ? (
    <p className="text-sm text-muted">{t('classificacaoDepois')}</p>
  ) : (
    <StageStandings standings={standings.data} participantHeader={participantHeader} highlightRegistrationId={me} />
  );

  const seedText =
    bracket.data.seedUsed &&
    t.rich('sorteio', {
      seed: bracket.data.seedUsed,
      codigo: (chunks) => <code className="tabular break-all text-text">{chunks}</code>,
    });
  const meta = (
    <div className="flex flex-col gap-2">
      {bracket.data.state === 'PREVIEW' && (
        <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-sm text-warning-soft-text">
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('previa')}
        </p>
      )}
      {bracket.data.seeding === 'RANDOM' && bracket.data.seedUsed && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>{seedText}</span>
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {meta}
      {elimination ? (
        <>
          <Section title={t('chave')}>
            <BracketView bracket={bracket.data} highlightRegistrationId={me} />
          </Section>
          <Section title={t('classificacao')}>{standingsBlock}</Section>
        </>
      ) : (
        <>
          <Section title={t('classificacao')}>{standingsBlock}</Section>
          <Section title={stage.format === 'BATTLE_ROYALE' || (stage.format === 'GROUPS' && stage.config.groupMode === 'BATTLE_ROYALE') ? t('quedas') : t('rodadas')}>
            <RoundsView bracket={bracket.data} highlightRegistrationId={me} />
          </Section>
        </>
      )}
    </div>
  );
}

export function BracketTab({ tournament }: { tournament: Tournament }) {
  const t = useT(messages, 'CompetitionTabs');
  const [param, setParam] = useUrlParam('fase');
  const stages = [...tournament.stages].sort((a, b) => a.order - b.order);
  const stage = stages.find((s) => s.id === param) ?? defaultStage(stages);

  if (!stage) return <EmptyState icon={<GitBranch className="size-7" />} title={t('semFasesTitulo')} description={t('semFasesDescricao')} />;
  const formatLabel = stageFormatLabel(stage.format);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg">
          {isEliminationFormat(stage.format) ? t('chaveEClassificacao') : t('tabelaEPartidas')}
          <span className="sr-only">{t('daFase', { nome: stage.name })}</span>
        </h2>
        {stages.length > 1 ? (
          <div role="group" aria-label={t('fase')} className="flex flex-wrap gap-2">
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
            {stage.name.trim().toLowerCase() !== formatLabel.toLowerCase() && <Badge tone="neutral">{formatLabel}</Badge>}
          </p>
        )}
      </div>
      {/* `key`: trocar de fase recomeça o estado interno (aba da rodada, zoom) do zero. */}
      <StageContent key={stage.id} tournament={tournament} stage={stage} />
    </div>
  );
}

// ── Partidas ─────────────────────────────────────────────────────────

export function MatchesTab({ tournament, matches }: { tournament: Tournament; matches: MatchesQuery }) {
  const t = useT(messages, 'CompetitionTabs');
  const [openId, setOpenId] = useUrlParam('partida');

  if (matches.isPending) return <BlockSkeleton label={t('carregandoPartidas')} rows={4} />;
  if (matches.isError || !matches.data) return <ErrorState title={t('erroPartidas')} description={errorMessage(matches.error)} onRetry={() => void matches.refetch()} />;

  const open = openId ? (matches.data.find((m) => m.id === openId) ?? null) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">{t('partidas')}</h2>
        <CalendarExport scope={{ kind: 'tournament', idOrSlug: tournament.slug, name: tournament.name }} />
      </div>
      <MatchesList matches={matches.data} stages={[...tournament.stages].sort((a, b) => a.order - b.order).map((s) => ({ id: s.id, name: s.name }))} onOpen={(m) => setOpenId(m.id)} />
      <MatchDetailModal match={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ── Resultados ───────────────────────────────────────────────────────

export function ResultsTab({ tournament, matches }: { tournament: Tournament; matches: MatchesQuery }) {
  const t = useT(messages, 'CompetitionTabs');
  const viewer = useMatchViewer();
  const podium = usePodium(tournament.id);
  const [openId, setOpenId] = useState<string | null>(null);

  if (matches.isPending) return <BlockSkeleton label={t('carregandoResultados')} rows={4} />;
  if (matches.isError || !matches.data) return <ErrorState title={t('erroResultados')} description={errorMessage(matches.error)} onRetry={() => void matches.refetch()} />;

  const recency = (m: Match) => m.updatedAt ?? m.scheduledAt ?? '';
  // Bye não é resultado: só entra partida com dois lados (ou a queda inteira).
  const concluded = matches.data.filter((m) => isConcluded(m) && m.participants.every((p) => p.registrationId !== null)).sort((a, b) => recency(b).localeCompare(recency(a)));
  const open = openId ? (matches.data.find((m) => m.id === openId) ?? null) : null;

  return (
    <div className="flex flex-col gap-8">
      <h2 className="sr-only">{t('resultados')}</h2>
      {podium.data && <Podium podium={podium.data} highlightRegistrationId={viewer.registration?.id} />}
      {tournament.status === 'FINISHED' && podium.isSuccess && !podium.data && <p className="text-sm text-muted">{t('semPodio')}</p>}
      <Section title={t('concluidas')} aside={<span className="tabular text-sm text-muted">{concluded.length}</span>}>
        {concluded.length === 0 ? (
          <EmptyState icon={<Trophy className="size-7" />} title={t('nenhumResultadoTitulo')} description={t('nenhumResultadoDescricao')} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('concluidasLista')}>
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
