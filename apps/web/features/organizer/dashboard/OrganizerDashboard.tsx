'use client';

import type { OrganizerTournament } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { CalendarClock, ClipboardCheck, FileStack, Hourglass, PencilLine, PlusCircle, Radio, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useOrganizerTournaments } from '@/shared/api/hooks/organizer';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { isActive } from '../lib/status';

function Stat({ icon: Icon, label, value, href, linkLabel }: { icon: LucideIcon; label: string; value: number; href: string; linkLabel: string }) {
  return (
    <Card className="flex items-center gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text" aria-hidden>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="tabular text-2xl font-bold text-text">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <Link href={href} className="min-h-11 shrink-0 content-center rounded-md px-2 text-sm font-semibold text-text underline hover:bg-neutral-soft" aria-label={linkLabel}>
        Ver
      </Link>
    </Card>
  );
}

/** Próximo acontecimento do campeonato: abertura, fechamento das inscrições ou início. */
function nextEvent(t: OrganizerTournament, now: number): { label: string; at: string } | null {
  const candidates: { label: string; at: string | null }[] = [
    { label: 'Inscrições abrem', at: t.status === 'PUBLISHED' ? t.registrationOpensAt : null },
    { label: 'Inscrições fecham', at: t.status === 'PUBLISHED' || t.status === 'REGISTRATION_OPEN' ? t.registrationClosesAt : null },
    { label: 'Começa', at: t.startsAt },
  ];
  const upcoming = candidates.filter((c): c is { label: string; at: string } => c.at !== null && new Date(c.at).getTime() > now).sort((a, b) => a.at.localeCompare(b.at));
  return upcoming[0] ?? null;
}

/** `/organizador` — Meu painel: resumo, próximos eventos e atalhos (issue #24). */
export function OrganizerDashboard() {
  const { user } = useSession();
  const query = useOrganizerTournaments();
  const [now] = useState(() => Date.now());

  const create = (label: string) => (
    <Button asChild>
      <Link href="/organizador/novo">
        <PlusCircle className="size-4" aria-hidden />
        {label}
      </Link>
    </Button>
  );

  if (!query.data) {
    return (
      <PageContainer>
        <PageHeader title="Meu painel" />
        {query.error ? (
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <div className="flex flex-col gap-4" role="status" aria-label="Carregando o painel">
            <div className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-56 w-full" />
          </div>
        )}
      </PageContainer>
    );
  }

  const list = query.data;
  if (list.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Meu painel" description={user ? `Olá, ${user.nickname}. Aqui você acompanha os seus campeonatos.` : undefined} />
        <EmptyState
          icon={<Trophy className="size-7" />}
          title="Seu primeiro campeonato começa aqui"
          description="Em poucos minutos você escolhe o jogo, monta as fases e publica. O assistente sugere vagas, datas, pontuação e regulamento."
          action={create('Criar meu primeiro campeonato')}
        />
        <p className="text-center text-sm text-muted">
          Prefere começar por algo pronto?{' '}
          <Link href="/organizador/modelos" className="font-semibold text-text underline">
            Veja os modelos
          </Link>
          .
        </p>
      </PageContainer>
    );
  }

  const active = list.filter((t) => isActive(t.status));
  const drafts = list.filter((t) => t.status === 'DRAFT');
  const pending = active.reduce((sum, t) => sum + t.pendingApprovals, 0);
  const withPending = active.filter((t) => t.pendingApprovals > 0);
  const events = active
    .map((t) => ({ t, event: nextEvent(t, now) }))
    .filter((x): x is { t: OrganizerTournament; event: { label: string; at: string } } => x.event !== null)
    .sort((a, b) => a.event.at.localeCompare(b.event.at))
    .slice(0, 5);
  const live = active.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'PAUSED');

  return (
    <PageContainer>
      <PageHeader title="Meu painel" description={user ? `Olá, ${user.nickname}. Veja o que pede a sua atenção.` : undefined} actions={create('Criar campeonato')} />

      <section aria-label="Resumo" className="grid gap-4 md:grid-cols-3">
        <Stat icon={Radio} label={active.length === 1 ? 'campeonato ativo' : 'campeonatos ativos'} value={active.length} href="/organizador/campeonatos" linkLabel="Ver campeonatos ativos" />
        <Stat icon={PencilLine} label={drafts.length === 1 ? 'rascunho' : 'rascunhos'} value={drafts.length} href="/organizador/campeonatos" linkLabel="Ver rascunhos" />
        <Stat
          icon={Hourglass}
          label={pending === 1 ? 'inscrição aguardando aprovação' : 'inscrições aguardando aprovação'}
          value={pending}
          href={withPending[0] ? `/organizador/campeonatos/${withPending[0].id}?aba=inscricoes` : '/organizador/campeonatos'}
          linkLabel="Ver inscrições aguardando aprovação"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {withPending.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg">Inscrições para aprovar</h2>
              <ul className="flex flex-col gap-2">
                {withPending.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-text">{t.name}</span>
                      <span className="text-muted"> · {t.pendingApprovals} aguardando</span>
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/organizador/campeonatos/${t.id}?aba=inscricoes`} aria-label={`Revisar inscrições de ${t.name}`}>
                        <ClipboardCheck className="size-4" aria-hidden />
                        Revisar
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg">Próximos eventos</h2>
            {events.length === 0 && live.length === 0 ? (
              <p className="text-sm text-muted">Nada marcado. Publique um campeonato para ver aqui as datas de inscrição e de início.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {live.map((t) => (
                  <li key={`live-${t.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <Link href={`/organizador/campeonatos/${t.id}`} className="min-w-0 text-sm font-semibold text-text underline-offset-2 hover:underline">
                      {t.name}
                    </Link>
                    <StatusPill status={t.status} />
                  </li>
                ))}
                {events.map(({ t, event }) => (
                  <li key={t.id} className="flex flex-col gap-1 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between md:gap-3">
                    <div className="min-w-0 text-sm">
                      <Link href={`/organizador/campeonatos/${t.id}`} className="font-semibold text-text underline-offset-2 hover:underline">
                        {t.name}
                      </Link>
                      <p className="flex items-center gap-1.5 text-muted">
                        <CalendarClock className="size-4 shrink-0" aria-hidden />
                        {event.label} {formatRelative(event.at, new Date(now))} · {formatDateTime(event.at)}
                      </p>
                    </div>
                    <StatusPill status={t.status} className="self-start md:self-auto" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {drafts.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg">Rascunhos para terminar</h2>
              <ul className="flex flex-col gap-2">
                {drafts.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-text">{t.name}</span>
                      <span className="text-muted"> · passo {t.draftStep + 1} de 7</span>
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/organizador/campeonatos/${t.id}/editar`} aria-label={`Continuar rascunho de ${t.name}`}>
                        <PencilLine className="size-4" aria-hidden />
                        Continuar
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="flex h-fit flex-col gap-3">
          <h2 className="text-lg">Atalhos</h2>
          <ul className="flex flex-col gap-2">
            {[
              { href: '/organizador/novo', label: 'Criar campeonato', icon: PlusCircle },
              { href: '/organizador/campeonatos', label: 'Meus campeonatos', icon: Trophy },
              { href: '/organizador/modelos', label: 'Modelos de campeonato', icon: FileStack },
            ].map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm font-semibold text-text hover:bg-surface-2">
                  <s.icon className="size-4 shrink-0 text-muted" aria-hidden />
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageContainer>
  );
}
