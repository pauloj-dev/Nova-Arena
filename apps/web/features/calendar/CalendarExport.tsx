'use client';

import type { CalendarFeed } from '@nova/schemas';
import { Button, ErrorState, Input, Modal, Skeleton, useToast, type ButtonProps } from '@nova/ui';
import { CalendarClock, CalendarPlus, Copy, Download, Info } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useDownloadCalendar, useMyCalendarFeed, useTournamentCalendarFeed } from '@/shared/api/hooks/calendar';
import { isModuleMocked } from '@/shared/api/mode';
import { useT } from '@/shared/i18n/react';
import { downloadFile } from '@/features/organizer/lib/download';
import { messages } from './messages';

export type CalendarScope = { kind: 'mine' } | { kind: 'tournament'; idOrSlug: string; name: string };

export interface CalendarExportProps {
  scope: CalendarScope;
  size?: ButtonProps['size'];
}

/** Aplicativos com o passo a passo de assinatura (textos em `messages`, trecho `FeedBody.ajuda`). */
const HELP = ['google', 'apple', 'outlook'] as const;

function FeedBody({ feed, scope }: { feed: CalendarFeed; scope: CalendarScope }) {
  const { success, error } = useToast();
  const download = useDownloadCalendar();
  const [copied, setCopied] = useState(false);
  const t = useT(messages, 'FeedBody');
  const mocked = isModuleMocked('calendar');

  async function copy() {
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      success(t('copiado'), t('copiadoDescricao'));
    } catch {
      error(t('erroCopiar'), t('erroCopiarDescricao'));
    }
  }

  function save() {
    download.mutate(feed, {
      onSuccess: ({ blob, filename }) => downloadFile(blob, filename, 'text/calendar'),
      onError: (e) => error(t('erroBaixar'), errorMessage(e)),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-sm text-text" role="status" data-testid="calendar-count">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        {feed.events === 0
          ? t('semPartidas')
          : t('partidas', { eventos: feed.events, escopo: scope.kind })}
      </p>

      <section aria-labelledby="assinar-calendario" className="flex flex-col gap-3">
        <h3 id="assinar-calendario" className="text-base">
          {t('assinar')}
        </h3>
        <p className="text-sm text-muted">{t('assinarDescricao')}</p>
        <div className="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
          <Button asChild>
            <a href={feed.webcalUrl}>
              <CalendarPlus className="size-4" aria-hidden />
              {t('abrirNoAplicativo')}
            </a>
          </Button>
          <Button variant="secondary" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy()}>
            {copied ? t('copiado') : t('copiarEndereco')}
          </Button>
        </div>
        <Input label={t('endereco')} value={feed.url} readOnly onFocus={(e) => e.currentTarget.select()} hint={scope.kind === 'mine' ? t('enderecoPessoal') : undefined} />
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text">{t('comoAssinar')}</summary>
          <ul className="flex flex-col gap-1 pb-2 text-muted">
            {HELP.map((h) => (
              <li key={h}>
                <strong className="text-text">{t(`ajuda.${h}.app`)}:</strong> {t(`ajuda.${h}.passos`)}
              </li>
            ))}
          </ul>
        </details>
        {mocked && (
          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('prototipo')}
          </p>
        )}
      </section>

      <section aria-labelledby="baixar-calendario" className="flex flex-col gap-2">
        <h3 id="baixar-calendario" className="text-base">
          {t('baixarIcs')}
        </h3>
        <p className="text-sm text-muted">{t('baixarDescricao')}</p>
        <div>
          <Button variant="secondary" loading={download.isPending} iconLeft={<Download className="size-4" aria-hidden />} onClick={save}>
            {t('baixarIcs')}
          </Button>
        </div>
      </section>
    </div>
  );
}

function MineFeed() {
  const query = useMyCalendarFeed();
  return <FeedState query={query} scope={{ kind: 'mine' }} />;
}

function TournamentFeed({ scope }: { scope: Extract<CalendarScope, { kind: 'tournament' }> }) {
  const query = useTournamentCalendarFeed(scope.idOrSlug);
  return <FeedState query={query} scope={scope} />;
}

function FeedState({ query, scope }: { query: ReturnType<typeof useMyCalendarFeed>; scope: CalendarScope }) {
  const t = useT(messages, 'FeedState');
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (query.isError) return <ErrorState title={t('erro')} description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  return <FeedBody feed={query.data} scope={scope} />;
}

/** "Calendário": assinar (webcal, atualiza sozinho) ou baixar o .ics das partidas — as minhas ou as de um campeonato. */
export function CalendarExport({ scope, size = 'sm' }: CalendarExportProps) {
  const [open, setOpen] = useState(false);
  const t = useT(messages, 'CalendarExport');
  const title = scope.kind === 'mine' ? t('tituloMinhas') : t('tituloCampeonato');
  return (
    <>
      <Button variant="secondary" size={size} iconLeft={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        {t('adicionar')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={scope.kind === 'mine' ? t('descricaoMinhas') : t('descricaoCampeonato', { nome: scope.name })}>
        {open && (scope.kind === 'mine' ? <MineFeed /> : <TournamentFeed scope={scope} />)}
      </Modal>
    </>
  );
}
