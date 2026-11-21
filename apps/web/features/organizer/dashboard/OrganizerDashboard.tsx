'use client';

import type { OrganizerTournament } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { CalendarClock, ClipboardCheck, FileStack, Hourglass, PencilLine, PlusCircle, Radio, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useOrganizerTournaments } from '@/shared/api/hooks/organizer';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { isActive } from '../lib/status';
import { messages } from '../messages';
import { EXAMPLE_TOURNAMENT, FirstSteps } from '../onboarding/FirstSteps';

function Stat({ icon: Icon, label, value, href, linkLabel }: { icon: LucideIcon; label: string; value: number; href: string; linkLabel: string }) {
  const t = useT(messages, 'OrganizerDashboard');
  return (
    <Card className="flex items-center gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text" aria-hidden>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="tabular text-2xl font-bold text-text">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <Link href={href} className="min-h-11 min-w-11 shrink-0 content-center rounded-md px-2 text-center text-sm font-semibold text-text underline hover:bg-neutral-soft" aria-label={linkLabel}>
        {t('ver')}
      </Link>
    </Card>
  );
}

/** Próximo acontecimento do campeonato: abertura, fechamento das inscrições ou início. */
function nextEvent(tournament: OrganizerTournament, now: number): { label: string; at: string } | null {
  const t = getT(messages, 'OrganizerDashboard');
  const candidates: { label: string; at: string | null }[] = [
    { label: t('inscricoesAbrem'), at: tournament.status === 'PUBLISHED' ? tournament.registrationOpensAt : null },
    { label: t('inscricoesFecham'), at: tournament.status === 'PUBLISHED' || tournament.status === 'REGISTRATION_OPEN' ? tournament.registrationClosesAt : null },
    { label: t('comeca'), at: tournament.startsAt },
  ];
  const upcoming = candidates.filter((c): c is { label: string; at: string } => c.at !== null && new Date(c.at).getTime() > now).sort((a, b) => a.at.localeCompare(b.at));
  return upcoming[0] ?? null;
}

/** `/organizador` — Meu painel: resumo, próximos eventos e atalhos (issue #24). */
export function OrganizerDashboard() {
  const t = useT(messages, 'OrganizerDashboard');
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
        <PageHeader title={t('titulo')} />
        {query.error ? (
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
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
    const startFromReady = t.rich('prefereProntoRich', {
      modelos: (chunks) => (
        <Link href="/organizador/modelos" className="font-semibold text-text underline">
          {chunks}
        </Link>
      ),
      exemplo: (chunks) => (
        <Link href={`/c/${EXAMPLE_TOURNAMENT.slug}`} className="font-semibold text-text underline">
          {chunks}
        </Link>
      ),
    });
    return (
      <PageContainer>
        <PageHeader title={t('titulo')} description={user ? t('olaVazio', { apelido: user.nickname }) : undefined} />
        <FirstSteps tournaments={list} />
        <EmptyState
          icon={<Trophy className="size-7" />}
          title={t('primeiroTitulo')}
          description={t('primeiroDescricao')}
          action={create(t('criarPrimeiro'))}
        />
        <p className="text-center text-sm text-muted">{startFromReady}</p>
      </PageContainer>
    );
  }

  const active = list.filter((tournament) => isActive(tournament.status));
  const drafts = list.filter((tournament) => tournament.status === 'DRAFT');
  const pending = active.reduce((sum, tournament) => sum + tournament.pendingApprovals, 0);
  const withPending = active.filter((tournament) => tournament.pendingApprovals > 0);
  const events = active
    .map((tournament) => ({ tournament, event: nextEvent(tournament, now) }))
    .filter((x): x is { tournament: OrganizerTournament; event: { label: string; at: string } } => x.event !== null)
    .sort((a, b) => a.event.at.localeCompare(b.event.at))
    .slice(0, 5);
  const live = active.filter((tournament) => tournament.status === 'IN_PROGRESS' || tournament.status === 'PAUSED');
  const shortcuts = [
    { href: '/organizador/novo', label: t('criarCampeonato'), icon: PlusCircle },
    { href: '/organizador/campeonatos', label: t('meusCampeonatos'), icon: Trophy },
    { href: '/organizador/modelos', label: t('modelos'), icon: FileStack },
  ];

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={user ? t('ola', { apelido: user.nickname }) : undefined} actions={create(t('criarCampeonato'))} />

      <FirstSteps tournaments={list} />

      <section aria-label={t('resumo')} className="grid gap-4 md:grid-cols-3">
        <Stat icon={Radio} label={t('ativos', { count: active.length })} value={active.length} href="/organizador/campeonatos" linkLabel={t('verAtivos')} />
        <Stat icon={PencilLine} label={t('rascunhos', { count: drafts.length })} value={drafts.length} href="/organizador/campeonatos" linkLabel={t('verRascunhos')} />
        <Stat
          icon={Hourglass}
          label={t('pendentes', { count: pending })}
          value={pending}
          href={withPending[0] ? `/organizador/campeonatos/${withPending[0].id}?aba=inscricoes` : '/organizador/campeonatos'}
          linkLabel={t('verPendentes')}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {withPending.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg">{t('paraAprovar')}</h2>
              <ul className="flex flex-col gap-2">
                {withPending.map((tournament) => (
                  <li key={tournament.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-text">{tournament.name}</span>
                      <span className="text-muted">{t('aguardando', { count: String(tournament.pendingApprovals) })}</span>
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/organizador/campeonatos/${tournament.id}?aba=inscricoes`} aria-label={t('revisarDe', { nome: tournament.name })}>
                        <ClipboardCheck className="size-4" aria-hidden />
                        {t('revisar')}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg">{t('proximosEventos')}</h2>
            {events.length === 0 && live.length === 0 ? (
              <p className="text-sm text-muted">{t('nadaMarcado')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {live.map((tournament) => (
                  <li key={`live-${tournament.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <Link href={`/organizador/campeonatos/${tournament.id}`} className="-my-3 min-w-0 py-3 text-sm font-semibold text-text underline-offset-2 hover:underline">
                      {tournament.name}
                    </Link>
                    <StatusPill status={tournament.status} />
                  </li>
                ))}
                {events.map(({ tournament, event }) => (
                  <li key={tournament.id} className="flex flex-col gap-1 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between md:gap-3">
                    <div className="min-w-0 text-sm">
                      <Link href={`/organizador/campeonatos/${tournament.id}`} className="font-semibold text-text underline-offset-2 hover:underline">
                        {tournament.name}
                      </Link>
                      <p className="flex items-center gap-1.5 text-muted">
                        <CalendarClock className="size-4 shrink-0" aria-hidden />
                        {t('evento', { evento: event.label, quando: formatRelative(event.at, new Date(now)), data: formatDateTime(event.at) })}
                      </p>
                    </div>
                    <StatusPill status={tournament.status} className="self-start md:self-auto" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {drafts.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg">{t('rascunhosParaTerminar')}</h2>
              <ul className="flex flex-col gap-2">
                {drafts.slice(0, 3).map((tournament) => (
                  <li key={tournament.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold text-text">{tournament.name}</span>
                      <span className="text-muted">{t('passo', { passo: String(tournament.draftStep + 1) })}</span>
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/organizador/campeonatos/${tournament.id}/editar`} aria-label={t('continuarDe', { nome: tournament.name })}>
                        <PencilLine className="size-4" aria-hidden />
                        {t('continuar')}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="flex h-fit flex-col gap-3">
          <h2 className="text-lg">{t('atalhos')}</h2>
          <ul className="flex flex-col gap-2">
            {shortcuts.map((s) => (
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
