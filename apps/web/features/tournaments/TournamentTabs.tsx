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
import { formatDateTime } from '@/shared/lib/datetime';
import { richTextToPlain, streamEmbed, type StreamEmbed } from '@/shared/lib/sanitize';
import { RichText } from './RichText';
import { describeAdvancement, describeStageFormat, STAGE_FORMAT_LABELS } from './stageText';

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
  const host = usePageHost();
  // Só Twitch e YouTube viram player (PRD §5.2). Qualquer outro link é descartado por `streamEmbed`.
  const embeds = host ? urls.map((u) => streamEmbed(u, host)).filter((e): e is StreamEmbed => e !== null) : [];
  if (embeds.length === 0) return null;
  return (
    <Section title="Transmissão">
      <div className="grid grid-cols-1 gap-4">
        {embeds.map((embed, i) => (
          <div key={embed.embedUrl} className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-2">
            <iframe
              src={embed.embedUrl}
              title={`Transmissão de ${tournamentName} no ${PROVIDER_NAME[embed.provider]}${embeds.length > 1 ? ` (${i + 1} de ${embeds.length})` : ''}`}
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

function Format({ tournament: t }: { tournament: Tournament }) {
  const game = useGame(t.gameId);
  if (t.stages.length === 0) {
    return (
      <Section title="Formato">
        <p className="text-sm text-muted">A organização ainda não divulgou as fases deste campeonato.</p>
      </Section>
    );
  }
  return (
    <Section title="Formato">
      <ol className="flex flex-col gap-3">
        {t.stages.map((stage, index) => {
          const model = game.data?.scoringModels.find((m) => m.id === stage.scoringModelId);
          return (
            <li key={stage.id}>
              <Card padding="sm" className="flex flex-col gap-2 md:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm text-accent-soft-text" aria-hidden>
                    {index + 1}
                  </span>
                  <h3 className="text-base">
                    <span className="sr-only">Fase {index + 1}: </span>
                    {stage.name}
                  </h3>
                  {/* Fase chamada "Fase de grupos" não precisa do selo repetindo o formato. */}
                  {stage.name.trim().toLowerCase() !== STAGE_FORMAT_LABELS[stage.format].toLowerCase() && <Badge tone="neutral">{STAGE_FORMAT_LABELS[stage.format]}</Badge>}
                </div>
                <dl className="flex flex-col gap-2 text-sm">
                  <div>
                    <dt className="font-semibold">Como funciona</dt>
                    <dd className="text-muted">{describeStageFormat(stage, t.participantType).join(' ')}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Pontuação</dt>
                    <dd className="text-muted">
                      {game.isPending ? (
                        <Skeleton className="mt-1 h-4 w-48" />
                      ) : model ? (
                        scoringLines(model, game.data).join(' · ')
                      ) : (
                        'Definida pela organização. Confira o regulamento.'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Quem avança</dt>
                    <dd className="text-muted">{describeAdvancement(stage.qualification, t.participantType)}</dd>
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

export function OverviewTab({ tournament: t }: { tournament: Tournament }) {
  const hasDescription = richTextToPlain(t.description) !== '';
  const hasPrize = richTextToPlain(t.prize) !== '';
  return (
    <div className="flex flex-col gap-8">
      <Section title="Sobre o campeonato">
        {hasDescription ? <RichText html={t.description} /> : <p className="text-sm text-muted">A organização ainda não escreveu a descrição.</p>}
      </Section>
      {hasPrize && (
        <Section title="Premiação">
          <RichText html={t.prize} />
        </Section>
      )}
      <Format tournament={t} />
      <Streams urls={t.streamUrls} tournamentName={t.name} />
    </div>
  );
}

// ── Regulamento ──────────────────────────────────────────────────────

export function RulesTab({ tournament: t }: { tournament: Tournament }) {
  if (richTextToPlain(t.rules) === '') {
    return <EmptyState icon={<FileText className="size-7" />} title="Regulamento ainda não publicado" description="Quando a organização publicar as regras, elas aparecem aqui." />;
  }
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">Regulamento</h2>
      <RichText html={t.rules} />
    </section>
  );
}

// ── Inscritos ────────────────────────────────────────────────────────

function Members({ registration }: { registration: Registration }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3" aria-label={`Membros de ${registration.displayName}`}>
      {registration.members.map((m) => (
        <li key={m.userId} className="flex min-w-0 items-center gap-1.5 text-sm">
          <Avatar name={m.nickname} src={m.avatarUrl} size="sm" />
          <Link href={`/u/${encodeURIComponent(m.nickname)}`} className="truncate underline-offset-2 hover:underline">
            {m.nickname}
          </Link>
          {m.isCaptain && (
            <span className="flex items-center gap-0.5 text-xs font-semibold text-gold-soft-text">
              <Crown className="size-3.5" aria-hidden />
              Capitão
            </span>
          )}
          {m.isSub && <span className="text-xs text-muted">(reserva)</span>}
          {!m.confirmedAt && <span className="text-xs text-muted">(aguardando confirmar)</span>}
        </li>
      ))}
    </ul>
  );
}

export function RegistrationsTab({ tournament: t }: { tournament: Tournament }) {
  const registrations = useTournamentRegistrations(t.id);
  const team = t.participantType === 'TEAM';

  if (registrations.isPending) return <ListSkeleton rows={4} label="Carregando inscritos" />;
  if (registrations.isError) return <ErrorState title="Não foi possível carregar os inscritos" description={errorMessage(registrations.error)} onRetry={() => void registrations.refetch()} />;
  if (registrations.data.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-7" />}
        title="Ninguém se inscreveu ainda"
        description={t.status === 'REGISTRATION_OPEN' ? `As inscrições estão abertas: ${team ? 'seu squad pode ser o primeiro' : 'você pode ser a primeira pessoa'}.` : 'Os inscritos aparecem aqui quando as inscrições abrirem.'}
      />
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">
        Inscritos <span className="tabular text-base text-muted">({registrations.data.length} de {t.maxParticipants})</span>
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Inscritos">
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
            {team && r.members.length > 0 && <Members registration={r} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Comunicados ──────────────────────────────────────────────────────

export function AnnouncementsTab({ tournament: t }: { tournament: Tournament }) {
  const announcements = useTournamentAnnouncements(t.id);

  if (announcements.isPending) return <ListSkeleton rows={2} label="Carregando comunicados" />;
  if (announcements.isError) return <ErrorState title="Não foi possível carregar os comunicados" description={errorMessage(announcements.error)} onRetry={() => void announcements.refetch()} />;
  if (announcements.data.length === 0) {
    return <EmptyState icon={<Megaphone className="size-7" />} title="Nenhum comunicado ainda" description="Os avisos da organização aparecem aqui. Siga o campeonato para ser avisado quando sair um novo." />;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">Comunicados</h2>
      <ul className="flex flex-col gap-3" aria-label="Comunicados">
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
