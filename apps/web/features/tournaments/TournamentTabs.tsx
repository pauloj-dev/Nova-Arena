'use client';

import type { Registration, Tournament } from '@nova/schemas';
import { Avatar, Badge, Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { Crown, FileText, Megaphone, Users } from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { scoringLines } from '@/features/games/scoringText';
import { errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useTournamentAnnouncements, useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { richTextToPlain, streamEmbed, type StreamEmbed } from '@/shared/lib/sanitize';
import { messages } from './messages';
import { RichText } from './RichText';
import { describeAdvancement, describeStageFormat, stageFormatLabel } from './stageText';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">{title}</h2>
      {children}
    </section>
  );
}

function ListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

// ── Visão geral ──────────────────────────────────────────────────────

const noopSubscribe = () => () => {};
/** Host da página, exigido pelo player da Twitch (`parent`). Vazio no servidor. */
function usePageHost(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.hostname,
    () => '',
  );
}

const PROVIDER_NAME: Record<StreamEmbed['provider'], string> = { youtube: 'YouTube', twitch: 'Twitch' };

function Streams({ urls, tournamentName }: { urls: string[]; tournamentName: string }) {
  const t = useT(messages, 'OverviewTab');
  const host = usePageHost();
  // Só Twitch e YouTube viram player (PRD §5.2). Qualquer outro link é descartado por `streamEmbed`.
  const embeds = host ? urls.map((u) => streamEmbed(u, host)).filter((e): e is StreamEmbed => e !== null) : [];
  if (embeds.length === 0) return null;
  return (
    <Section title={t('transmissao')}>
      <div className="grid grid-cols-1 gap-4">
        {embeds.map((embed, i) => (
          <div key={embed.embedUrl} className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-2">
            <iframe
              src={embed.embedUrl}
              title={t('transmissaoTitulo', { nome: tournamentName, provedor: PROVIDER_NAME[embed.provider], posicao: i + 1, total: embeds.length })}
              loading="lazy"
              // O player precisa de script e da própria origem; não ganha acesso à nossa página, a formulários nem a navegação do topo.
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              allow="fullscreen; picture-in-picture; encrypted-media"
              referrerPolicy="strict-origin-when-cross-origin"
              className="size-full border-0"
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Format({ tournament }: { tournament: Tournament }) {
  const t = useT(messages, 'OverviewTab');
  const game = useGame(tournament.gameId);
  if (tournament.stages.length === 0) {
    return (
      <Section title={t('formato')}>
        <p className="text-sm text-muted">{t('semFases')}</p>
      </Section>
    );
  }
  return (
    <Section title={t('formato')}>
      <ol className="flex flex-col gap-3">
        {tournament.stages.map((stage, index) => {
          const formatLabel = stageFormatLabel(stage.format);
          const model = game.data?.scoringModels.find((m) => m.id === stage.scoringModelId);
          return (
            <li key={stage.id}>
              <Card padding="sm" className="flex flex-col gap-2 md:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm text-accent-soft-text" aria-hidden>
                    {index + 1}
                  </span>
                  <h3 className="text-base">
                    <span className="sr-only">{t('fase', { n: index + 1 })}</span>
                    {stage.name}
                  </h3>
                  {/* Fase chamada "Fase de grupos" não precisa do selo repetindo o formato. */}
                  {stage.name.trim().toLowerCase() !== formatLabel.toLowerCase() && <Badge tone="neutral">{formatLabel}</Badge>}
                </div>
                <dl className="flex flex-col gap-2 text-sm">
                  <div>
                    <dt className="font-semibold">{t('comoFunciona')}</dt>
                    <dd className="text-muted">{describeStageFormat(stage, tournament.participantType).join(' ')}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('pontuacao')}</dt>
                    <dd className="text-muted">
                      {game.isPending ? (
                        <Skeleton className="mt-1 h-4 w-48" />
                      ) : model ? (
                        scoringLines(model, game.data).join(' · ')
                      ) : (
                        t('pontuacaoPadrao')
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">{t('quemAvanca')}</dt>
                    <dd className="text-muted">{describeAdvancement(stage.qualification, tournament.participantType)}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

export function OverviewTab({ tournament }: { tournament: Tournament }) {
  const t = useT(messages, 'OverviewTab');
  const hasDescription = richTextToPlain(tournament.description) !== '';
  const hasPrize = richTextToPlain(tournament.prize) !== '';
  return (
    <div className="flex flex-col gap-8">
      <Section title={t('sobre')}>
        {hasDescription ? <RichText html={tournament.description} /> : <p className="text-sm text-muted">{t('semDescricao')}</p>}
      </Section>
      {hasPrize && (
        <Section title={t('premiacao')}>
          <RichText html={tournament.prize} />
        </Section>
      )}
      <Format tournament={tournament} />
      <Streams urls={tournament.streamUrls} tournamentName={tournament.name} />
    </div>
  );
}

// ── Regulamento ──────────────────────────────────────────────────────

export function RulesTab({ tournament }: { tournament: Tournament }) {
  const t = useT(messages, 'RulesTab');
  if (richTextToPlain(tournament.rules) === '') {
    return <EmptyState icon={<FileText className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />;
  }
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">{t('titulo')}</h2>
      <RichText html={tournament.rules} />
    </section>
  );
}

// ── Inscritos ────────────────────────────────────────────────────────

function Members({ registration }: { registration: Registration }) {
  const t = useT(messages, 'RegistrationsTab');
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3" aria-label={t('membrosDe', { nome: registration.displayName })}>
      {registration.members.map((m) => (
        <li key={m.userId} className="flex min-w-0 items-center gap-1.5 text-sm">
          <Avatar name={m.nickname} src={m.avatarUrl} size="sm" />
          <Link href={`/u/${encodeURIComponent(m.nickname)}`} className="truncate underline-offset-2 hover:underline">
            {m.nickname}
          </Link>
          {m.isCaptain && (
            <span className="flex items-center gap-0.5 text-xs font-semibold text-gold-soft-text">
              <Crown className="size-3.5" aria-hidden />
              {t('capitao')}
            </span>
          )}
          {m.isSub && <span className="text-xs text-muted">{t('reserva')}</span>}
          {!m.confirmedAt && <span className="text-xs text-muted">{t('aguardandoConfirmar')}</span>}
        </li>
      ))}
      {/* Jogadores sem conta na plataforma (squad cadastrado pela organização, RN-18): só o nome. */}
      {registration.guests.map((g) => (
        <li key={g.id} className="flex min-w-0 items-center gap-1.5 text-sm">
          <Avatar name={g.name} size="sm" />
          <span className="truncate">{g.name}</span>
          {g.isSub && <span className="text-xs text-muted">{t('reserva')}</span>}
        </li>
      ))}
    </ul>
  );
}

export function RegistrationsTab({ tournament }: { tournament: Tournament }) {
  const t = useT(messages, 'RegistrationsTab');
  const registrations = useTournamentRegistrations(tournament.id);
  const team = tournament.participantType === 'TEAM';

  if (registrations.isPending) return <ListSkeleton rows={4} label={t('carregando')} />;
  if (registrations.isError) return <ErrorState title={t('erroCarregar')} description={errorMessage(registrations.error)} onRetry={() => void registrations.refetch()} />;
  if (registrations.data.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-7" />}
        title={t('vazioTitulo')}
        description={tournament.status === 'REGISTRATION_OPEN' ? t('vazioAbertas', { participante: tournament.participantType }) : t('vazioFechadas')}
      />
    );
  }

  const heading = t.rich('titulo', {
    inscritos: registrations.data.length,
    vagas: tournament.maxParticipants,
    contagem: (chunks) => <span className="tabular text-base text-muted">{chunks}</span>,
  });
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">{heading}</h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('lista')}>
        {registrations.data.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={r.displayName} src={r.logoUrl} size="md" />
                <div className="min-w-0">
                  {!team && r.userId ? (
                    <Link href={`/u/${encodeURIComponent(r.displayName)}`} className="block truncate font-semibold underline-offset-2 hover:underline">
                      {r.displayName}
                    </Link>
                  ) : (
                    <p className="truncate font-semibold">{r.displayName}</p>
                  )}
                  {r.tag && <p className="tabular text-xs text-muted">[{r.tag}]</p>}
                </div>
              </div>
              <StatusPill status={r.status} className="shrink-0" />
            </div>
            {team && r.members.length + r.guests.length > 0 && <Members registration={r} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Comunicados ──────────────────────────────────────────────────────

export function AnnouncementsTab({ tournament }: { tournament: Tournament }) {
  const t = useT(messages, 'AnnouncementsTab');
  const announcements = useTournamentAnnouncements(tournament.id);

  if (announcements.isPending) return <ListSkeleton rows={2} label={t('carregando')} />;
  if (announcements.isError) return <ErrorState title={t('erroCarregar')} description={errorMessage(announcements.error)} onRetry={() => void announcements.refetch()} />;
  if (announcements.data.length === 0) {
    return <EmptyState icon={<Megaphone className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">{t('titulo')}</h2>
      <ul className="flex flex-col gap-3" aria-label={t('titulo')}>
        {announcements.data.map((a) => (
          <li key={a.id}>
            <Card padding="sm" className="flex flex-col gap-2 md:p-4">
              <h3 className="text-base">{a.title}</h3>
              {/* Texto puro: o React escapa qualquer HTML que venha aqui. */}
              <p className="whitespace-pre-line break-words text-sm">{a.body}</p>
              <p className="text-xs text-muted">
                {a.authorNickname} · {formatDateTime(a.createdAt)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
