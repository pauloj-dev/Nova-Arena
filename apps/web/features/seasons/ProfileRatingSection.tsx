'use client';

/**
 * Rating da temporada no perfil público (issue #120): um cartão por jogo com o rating, a posição, o pico, a evolução
 * (gráfico + lista em texto) e o link para a tabela. Só aparece com a flag `ranking` ligada e quando a pessoa jogou.
 */
import type { SubjectRating } from '@nova/schemas';
import { Card, ErrorState, Skeleton } from '@nova/ui';
import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useUserRating } from '@/shared/api/hooks/seasons';
import { useFlag } from '@/shared/flags/useFlag';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import { ProvisionalBadge, RatingDelta, RatingHistoryList, RatingSparkline } from './RatingBits';

function RatingCard({ entry, initial, provisionalMatches }: { entry: SubjectRating; initial: number; provisionalMatches: number }) {
  const last = entry.history.at(-1);
  const t = useT(messages, 'RatingCard');
  return (
    <Card className="min-w-0">
      <article aria-label={t('ratingEm', { jogo: entry.game.name })} className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-base">
          <span aria-hidden className="text-xl leading-none">
            {entry.game.icon}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{entry.game.name}</span>
          <span className="ml-auto text-xs font-normal text-muted">{entry.season.name}</span>
        </h3>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <p className="flex items-baseline gap-2">
            <span className="tabular text-3xl font-bold text-text">{entry.rating}</span>
            <span className="text-sm text-muted">{t('deRating')}</span>
          </p>
          {last && <RatingDelta delta={last.delta} />}
          {entry.provisional && <ProvisionalBadge matches={provisionalMatches} />}
        </div>
        <RatingSparkline history={entry.history} initial={initial} className="h-16 w-full" />
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">{t('posicao')}</dt>
            <dd className="tabular font-bold">{t('posicaoValor', { posicao: String(entry.position) })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('pico')}</dt>
            <dd className="tabular font-bold">{entry.peak}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('vitoriasEmpatesDerrotas')}</dt>
            <dd className="tabular font-bold">
              {entry.wins} / {entry.draws} / {entry.losses}
            </dd>
          </div>
        </dl>
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-accent md:min-h-0">{t('ultimasPartidas', { partidas: String(entry.played) })}</summary>
          <RatingHistoryList history={entry.history} />
        </details>
        <Link href={`/ranking?jogo=${entry.game.slug}`} className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
          {t('verTabela')}
        </Link>
      </article>
    </Card>
  );
}

export function ProfileRatingSection({ nickname }: { nickname: string }) {
  const enabled = useFlag('ranking');
  const rating = useUserRating(nickname, { enabled });
  const t = useT(messages, 'ProfileRatingSection');
  if (!enabled) return null;
  // Quem ainda não jogou na temporada não tem a seção (o histórico competitivo logo abaixo já explica).
  if (rating.isSuccess && rating.data.entries.length === 0) return null;

  return (
    <section aria-labelledby="perfil-rating" className="flex flex-col gap-3">
      <h2 id="perfil-rating" className="flex items-center gap-2 text-lg">
        <TrendingUp className="size-5 text-accent" aria-hidden />
        {t('titulo')}
      </h2>
      {rating.isPending ? (
        <div role="status" aria-label={t('carregando')} className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-56 w-full" />
        </div>
      ) : rating.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(rating.error)} onRetry={() => void rating.refetch()} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rating.data.entries.map((entry) => (
            <RatingCard key={entry.game.id} entry={entry} initial={rating.data.settings.initial} provisionalMatches={rating.data.settings.provisionalMatches} />
          ))}
        </div>
      )}
    </section>
  );
}
