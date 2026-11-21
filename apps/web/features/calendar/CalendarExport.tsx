'use client';

import type { CalendarFeed } from '@nova/schemas';
import { Button, ErrorState, Input, Modal, Skeleton, useToast, type ButtonProps } from '@nova/ui';
import { CalendarClock, CalendarPlus, Copy, Download, Info } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useDownloadCalendar, useMyCalendarFeed, useTournamentCalendarFeed } from '@/shared/api/hooks/calendar';
import { isModuleMocked } from '@/shared/api/mode';
import { downloadFile } from '@/features/organizer/lib/download';

export type CalendarScope = { kind: 'mine' } | { kind: 'tournament'; idOrSlug: string; name: string };

export interface CalendarExportProps {
  scope: CalendarScope;
  size?: ButtonProps['size'];
}

const HELP = [
  { app: 'Google Agenda', steps: 'no computador, "Outras agendas" → "+" → "Do URL" e cole o endereço.' },
  { app: 'Apple (iPhone e Mac)', steps: 'toque em "Abrir no aplicativo de calendário" ou, no Mac, Arquivo → Nova assinatura de calendário.' },
  { app: 'Outlook', steps: '"Adicionar calendário" → "Assinar da Web" e cole o endereço.' },
];

function FeedBody({ feed, scope }: { feed: CalendarFeed; scope: CalendarScope }) {
  const { success, error } = useToast();
  const download = useDownloadCalendar();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      success('Endereço copiado', 'Cole no seu aplicativo de calendário para assinar.');
    } catch {
      error('Não foi possível copiar', 'Selecione o endereço no campo e copie.');
    }
  }

  function save() {
    download.mutate(feed, {
      onSuccess: ({ blob, filename }) => downloadFile(blob, filename, 'text/calendar'),
      onError: (e) => error('Não foi possível baixar o calendário', errorMessage(e)),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-sm text-text" role="status" data-testid="calendar-count">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        {feed.events === 0
          ? 'Ainda não há partidas com horário marcado. Se você assinar agora, elas aparecem sozinhas quando forem marcadas.'
          : `${feed.events} ${feed.events === 1 ? 'partida com horário marcado' : 'partidas com horário marcado'}${scope.kind === 'mine' ? ' para você' : ''}. Horários no seu fuso, com lembrete 15 minutos antes.`}
      </p>

      <section aria-labelledby="assinar-calendario" className="flex flex-col gap-3">
        <h3 id="assinar-calendario" className="text-base">
          Assinar no calendário
        </h3>
        <p className="text-sm text-muted">Assinando, o calendário se atualiza sozinho quando uma partida muda de horário.</p>
        <div className="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
          <Button asChild>
            <a href={feed.webcalUrl}>
              <CalendarPlus className="size-4" aria-hidden />
              Abrir no aplicativo de calendário
            </a>
          </Button>
          <Button variant="secondary" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy()}>
            {copied ? 'Endereço copiado' : 'Copiar endereço'}
          </Button>
        </div>
        <Input label="Endereço do calendário" value={feed.url} readOnly onFocus={(e) => e.currentTarget.select()} hint={scope.kind === 'mine' ? 'Este endereço é pessoal: não compartilhe.' : undefined} />
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text">Como assinar em cada aplicativo</summary>
          <ul className="flex flex-col gap-1 pb-2 text-muted">
            {HELP.map((h) => (
              <li key={h.app}>
                <strong className="text-text">{h.app}:</strong> {h.steps}
              </li>
            ))}
          </ul>
        </details>
        {isModuleMocked('calendar') && (
          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            No protótipo, o endereço só funciona neste navegador. Para testar no seu calendário, baixe o arquivo.
          </p>
        )}
      </section>

      <section aria-labelledby="baixar-calendario" className="flex flex-col gap-2">
        <h3 id="baixar-calendario" className="text-base">
          Baixar arquivo .ics
        </h3>
        <p className="text-sm text-muted">Uma cópia das partidas de agora, para importar uma vez. Não se atualiza sozinha.</p>
        <div>
          <Button variant="secondary" loading={download.isPending} iconLeft={<Download className="size-4" aria-hidden />} onClick={save}>
            Baixar arquivo .ics
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
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando o calendário">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (query.isError) return <ErrorState title="Não foi possível preparar o calendário" description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  return <FeedBody feed={query.data} scope={scope} />;
}

/** "Calendário": assinar (webcal, atualiza sozinho) ou baixar o .ics das partidas — as minhas ou as de um campeonato. */
export function CalendarExport({ scope, size = 'sm' }: CalendarExportProps) {
  const [open, setOpen] = useState(false);
  const title = scope.kind === 'mine' ? 'Minhas partidas no calendário' : 'Partidas no calendário';
  return (
    <>
      <Button variant="secondary" size={size} iconLeft={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        Adicionar ao calendário
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={scope.kind === 'mine' ? 'Todas as suas partidas marcadas, de todos os campeonatos.' : `Todas as partidas marcadas de ${scope.name}.`}>
        {open && (scope.kind === 'mine' ? <MineFeed /> : <TournamentFeed scope={scope} />)}
      </Modal>
    </>
  );
}
