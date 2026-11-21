'use client';

/**
 * Tabela da temporada (rating ELO) de um jogo, dentro de `/ranking` (issue #120). Jogadores ou squads; temporada
 * atual por padrão, com seletor das anteriores. A página já está atrás da flag `ranking`.
 */
import { SEASON_STATUS_LABELS, type RatingKind, type SeasonRanking, type SeasonRankingEntry } from '@nova/schemas';
import { Avatar, cn, DataTable, EmptyState, ErrorState, Select, Skeleton, type Column } from '@nova/ui';
import { CalendarRange, Info, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useSeasonRanking } from '@/shared/api/hooks/seasons';
import { formatDate } from '@/shared/lib/datetime';
import { ProvisionalBadge, RatingDelta } from './RatingBits';

const KINDS: { value: RatingKind; label: string }[] = [
  { value: 'PLAYER', label: 'Jogadores' },
  { value: 'TEAM', label: 'Squads' },
];

export function seasonRankingColumns(kind: RatingKind, provisionalMatches: number): Column<SeasonRankingEntry>[] {
  return [
    { id: 'position', header: 'Posição', cell: (r) => <span className="tabular">{r.position}º</span>, className: 'w-20' },
    {
      id: 'name',
      header: kind === 'PLAYER' ? 'Jogador' : 'Squad',
      primary: true,
      cell: (r) => {
        const content = (
          <>
            <Avatar name={r.name} src={r.avatarUrl} size="sm" />
            <span className="truncate">{r.name}</span>
            {r.tag && <span className="text-xs text-muted">[{r.tag}]</span>}
          </>
        );
        return r.href ? (
          <Link href={r.href} className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold underline-offset-2 hover:underline md:min-h-0">
            {content}
          </Link>
        ) : (
          <span className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold md:min-h-0">{content}</span>
        );
      },
    },
    {
      id: 'rating',
      header: 'Rating',
      align: 'right',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          {r.provisional && <ProvisionalBadge matches={provisionalMatches} />}
          <span className="tabular text-base font-bold">{r.rating}</span>
          <RatingDelta delta={r.lastDelta} />
        </span>
      ),
    },
    { id: 'played', header: 'Partidas', align: 'right', cell: (r) => <span className="tabular">{r.played}</span> },
    {
      id: 'record',
      header: 'V / E / D',
      align: 'right',
      cell: (r) => (
        <span className="tabular" aria-label={`${r.wins} vitórias, ${r.draws} empates, ${r.losses} derrotas`}>
          {r.wins} / {r.draws} / {r.losses}
        </span>
      ),
    },
    { id: 'peak', header: 'Pico', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.peak}</span> },
  ];
}

const chip = 'flex min-h-11 items-center rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-text transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-text';

function SeasonInfo({ data }: { data: SeasonRanking }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Todo mundo começa a temporada com {data.settings.initial} de rating. Cada partida validada muda o rating: vencer quem está acima vale mais, perder para quem está abaixo custa mais. Nas quedas de Battle Royale, conta a colocação contra cada equipe da sala. W.O. não conta. O rating fica provisório nas primeiras {data.settings.provisionalMatches} partidas.
      </span>
    </p>
  );
}

/** Use com `key={game.slug}`: trocar de jogo volta para a temporada atual. */
export function SeasonRankingSection({ game }: { game: { slug: string; name: string } }) {
  const [kind, setKind] = useState<RatingKind>('PLAYER');
  const [season, setSeason] = useState<string | undefined>(undefined);
  const ranking = useSeasonRanking(game.slug, { kind, season });
  const data = ranking.data;

  return (
    <section aria-labelledby="ranking-temporada" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h2 id="ranking-temporada" className="flex items-center gap-2 text-lg">
            <TrendingUp className="size-5 text-accent" aria-hidden />
            Temporada de {game.name}
          </h2>
          {data?.season ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <CalendarRange className="size-4" aria-hidden />
              {data.season.name} · {formatDate(data.season.startsAt)} a {formatDate(new Date(new Date(data.season.endsAt).getTime() - 1).toISOString())} · {SEASON_STATUS_LABELS[data.season.status]}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div role="group" aria-label="Mostrar a tabela de" className="flex gap-2">
            {KINDS.map((k) => (
              <button key={k.value} type="button" className={cn(chip)} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
                {k.label}
              </button>
            ))}
          </div>
          {data && data.seasons.length > 1 && (
            <Select
              label="Temporada"
              className="min-w-48"
              value={season ?? data.season?.id ?? ''}
              onChange={(e) => setSeason(e.target.value || undefined)}
              options={data.seasons.map((s) => ({ value: s.id, label: `${s.name} (${SEASON_STATUS_LABELS[s.status].toLowerCase()})` }))}
            />
          )}
        </div>
      </div>

      {ranking.isPending ? (
        <div role="status" aria-label="Carregando a tabela da temporada" className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : ranking.isError ? (
        <ErrorState title="Não foi possível carregar a tabela da temporada" description={errorMessage(ranking.error)} onRetry={() => void ranking.refetch()} />
      ) : !data?.season ? (
        <EmptyState icon={<CalendarRange className="size-7" />} title={`Nenhuma temporada de ${game.name} em andamento`} description="Quando a administração abrir uma temporada, cada partida validada passa a contar aqui." />
      ) : (
        <>
          <SeasonInfo data={data} />
          <DataTable
            caption={`Temporada ${data.season.name} de ${game.name}: ${kind === 'PLAYER' ? 'jogadores' : 'squads'}`}
            columns={seasonRankingColumns(kind, data.settings.provisionalMatches)}
            rows={data.entries}
            getRowId={(r) => r.subjectId}
            empty={
              <EmptyState
                icon={<TrendingUp className="size-7" />}
                title={kind === 'PLAYER' ? 'Ninguém jogou nesta temporada ainda' : 'Nenhum squad jogou nesta temporada ainda'}
                description="A tabela começa com a primeira partida validada de um campeonato deste jogo."
              />
            }
          />
        </>
      )}
    </section>
  );
}
