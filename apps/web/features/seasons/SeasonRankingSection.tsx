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
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatDate } from '@/shared/lib/datetime';
import { messages } from './messages';
import { ProvisionalBadge, RatingDelta } from './RatingBits';

const KINDS: RatingKind[] = ['PLAYER', 'TEAM'];

export function seasonRankingColumns(kind: RatingKind, provisionalMatches: number): Column<SeasonRankingEntry>[] {
  const t = getT(messages, 'SeasonRankingSection.colunas');
  return [
    { id: 'position', header: t('posicao'), cell: (r) => <span className="tabular">{t('posicaoValor', { posicao: String(r.position) })}</span>, className: 'w-20' },
    {
      id: 'name',
      header: t('nome', { tipo: kind }),
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
      header: t('rating'),
      align: 'right',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          {r.provisional && <ProvisionalBadge matches={provisionalMatches} />}
          <span className="tabular text-base font-bold">{r.rating}</span>
          <RatingDelta delta={r.lastDelta} />
        </span>
      ),
    },
    { id: 'played', header: t('partidas'), align: 'right', cell: (r) => <span className="tabular">{r.played}</span> },
    {
      id: 'record',
      header: t('campanha'),
      align: 'right',
      cell: (r) => (
        <span className="tabular" aria-label={t('campanhaExtenso', { vitorias: String(r.wins), empates: String(r.draws), derrotas: String(r.losses) })}>
          {r.wins} / {r.draws} / {r.losses}
        </span>
      ),
    },
    { id: 'peak', header: t('pico'), align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.peak}</span> },
  ];
}

const chip = 'flex min-h-11 items-center rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-text transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-text';

function SeasonInfo({ data }: { data: SeasonRanking }) {
  const t = useT(messages, 'SeasonRankingSection');
  return (
    <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {t('info', { inicial: String(data.settings.initial), partidas: String(data.settings.provisionalMatches) })}
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
  const t = useT(messages, 'SeasonRankingSection');

  return (
    <section aria-labelledby="ranking-temporada" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h2 id="ranking-temporada" className="flex items-center gap-2 text-lg">
            <TrendingUp className="size-5 text-accent" aria-hidden />
            {t('temporadaDe', { jogo: game.name })}
          </h2>
          {data?.season ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <CalendarRange className="size-4" aria-hidden />
              {t('resumoTemporada', {
                nome: data.season.name,
                inicio: formatDate(data.season.startsAt),
                fim: formatDate(new Date(new Date(data.season.endsAt).getTime() - 1).toISOString()),
                situacao: SEASON_STATUS_LABELS[data.season.status],
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div role="group" aria-label={t('mostrarTabelaDe')} className="flex gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" className={cn(chip)} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(`tipos.${k}`)}
              </button>
            ))}
          </div>
          {data && data.seasons.length > 1 && (
            <Select
              label={t('temporada')}
              className="min-w-48"
              value={season ?? data.season?.id ?? ''}
              onChange={(e) => setSeason(e.target.value || undefined)}
              options={data.seasons.map((s) => ({ value: s.id, label: t('opcaoTemporada', { nome: s.name, situacao: SEASON_STATUS_LABELS[s.status].toLowerCase() }) }))}
            />
          )}
        </div>
      </div>

      {ranking.isPending ? (
        <div role="status" aria-label={t('carregando')} className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : ranking.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(ranking.error)} onRetry={() => void ranking.refetch()} />
      ) : !data?.season ? (
        <EmptyState icon={<CalendarRange className="size-7" />} title={t('semTemporadaTitulo', { jogo: game.name })} description={t('semTemporadaDescricao')} />
      ) : (
        <>
          <SeasonInfo data={data} />
          <DataTable
            caption={t('legenda', { temporada: data.season.name, jogo: game.name, tipo: kind })}
            columns={seasonRankingColumns(kind, data.settings.provisionalMatches)}
            rows={data.entries}
            getRowId={(r) => r.subjectId}
            empty={
              <EmptyState
                icon={<TrendingUp className="size-7" />}
                title={t('vazioTitulo', { tipo: kind })}
                description={t('vazioDescricao')}
              />
            }
          />
        </>
      )}
    </section>
  );
}
