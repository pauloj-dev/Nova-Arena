'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { DisputeMessageInput, type Dispute, type Match, type ResultSubmission, type TournamentAccessLevel } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, Textarea, useToast, type BadgeTone } from '@nova/ui';
import { AlertTriangle, ArrowLeft, CheckCircle2, Lock, MessageSquare, Scale, Send, ShieldAlert, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useMatch } from '@/shared/api/hooks/competition';
import { useDispute, useSendDisputeMessage, useSubmission } from '@/shared/api/hooks/disputes';
import { useTournament, useTournamentAccess } from '@/shared/api/hooks/tournaments';
import { keys } from '@/shared/api/keys';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { useChannel } from '@/shared/realtime/RealtimeProvider';
import { useSession } from '@/shared/session/useSession';
import { useQueryClient } from '@tanstack/react-query';
import { EscalateDialog, ResolveDialog } from './DisputeDecision';
import { EvidenceGallery } from './evidence/EvidenceGallery';
import { EvidenceUpload } from '@/features/evidence/EvidenceUpload';
import { scoreLine } from './scoreForm';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

type Message = Dispute['messages'][number];

/** Cor do selo de quem escreveu (o nome do papel vem do catálogo: `DisputePage.papel`). */
const ROLE_TONE: Record<Message['authorRole'], BadgeTone> = {
  PARTICIPANT: 'neutral',
  STAFF: 'accent',
  ADMIN: 'info',
};

/** Mantém a disputa em dia: decisão/contestação chegam pelo canal do campeonato; mensagens, pela notificação. */
function useLiveDispute(dispute: Dispute | undefined, userId: string | undefined): void {
  const qc = useQueryClient();
  const refresh = () => {
    if (!dispute) return;
    void qc.invalidateQueries({ queryKey: keys.matches.dispute(dispute.id) });
    void qc.invalidateQueries({ queryKey: keys.matches.detail(dispute.matchId) });
    void qc.invalidateQueries({ queryKey: keys.matches.submissions({ id: dispute.submissionId ?? '' }) });
  };
  useChannel(dispute ? `tournament:${dispute.tournamentId}` : null, (event) => {
    if (event.type === 'match.updated' && event.matchId === dispute?.matchId) refresh();
  });
  useChannel(dispute && userId ? `user:${userId}` : null, (event) => {
    if (event.type === 'notification.created') refresh();
  });
}

/** `/disputas/[id]`: histórico da disputa para os envolvidos, o staff do campeonato e a administração. */
export function DisputePage({ disputeId }: { disputeId: string }) {
  const t = useT(messages, 'DisputePage');
  const { user } = useSession();
  const dispute = useDispute(disputeId);
  useLiveDispute(dispute.data, user?.id);

  if (dispute.isPending) {
    return (
      <PageContainer narrow>
        <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (dispute.isError) {
    const status = dispute.error instanceof ApiError ? dispute.error.status : 0;
    return (
      <PageContainer narrow>
        <h1 className="text-xl md:text-2xl">{t('titulo')}</h1>
        {status === 403 ? (
          <EmptyState
            icon={<Lock className="size-7" />}
            title={t('semAcessoTitulo')}
            description={t('semAcessoDescricao')}
            action={
              <Button asChild variant="secondary">
                <Link href="/minha-conta/campeonatos">Meus campeonatos</Link>
              </Button>
            }
          />
        ) : status === 404 ? (
          <EmptyState
            icon={<Scale className="size-7" />}
            title={t('naoEncontradaTitulo')}
            description={t('naoEncontradaDescricao')}
            action={
              <Button asChild variant="secondary">
                <Link href="/minha-conta/campeonatos">Meus campeonatos</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title={t('erro')} description={errorMessage(dispute.error)} onRetry={() => void dispute.refetch()} />
        )}
      </PageContainer>
    );
  }

  return <DisputeDetail dispute={dispute.data} />;
}

function DisputeDetail({ dispute }: { dispute: Dispute }) {
  const t = useT(messages, 'DisputePage');
  const tournament = useTournament(dispute.tournamentId);
  const match = useMatch(dispute.matchId);
  const submission = useSubmission(dispute.submissionId);
  const access = useTournamentAccess(dispute.tournamentId);
  const backHref = tournament.data ? `/c/${tournament.data.slug}?aba=partidas` : null;

  return (
    <PageContainer narrow>
      {backHref && (
        <Link href={backHref} className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> {dispute.tournamentName}
        </Link>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 text-xl [overflow-wrap:anywhere] md:text-2xl">{t('tituloDisputa', { partida: dispute.matchLabel })}</h1>
          <StatusPill status={dispute.status} />
        </div>
        <p className="text-sm text-muted">
          {dispute.tournamentName} · {t(`ajudaStatus.${dispute.status}`)}
        </p>
      </div>

      <Card>
        <section aria-labelledby="disputa-historico" className="flex flex-col gap-4">
          <h2 id="disputa-historico" className="text-lg">
            {t('historico')}
          </h2>
          <Timeline dispute={dispute} submission={submission.data} match={match.data} />
        </section>
      </Card>

      {dispute.status !== 'RESOLVED' && (
        <>
          <Card>
            <MessageBox disputeId={dispute.id} />
          </Card>
          {access.data && <StaffActions dispute={dispute} access={access.data} submission={submission.data} match={match.data} />}
        </>
      )}
    </PageContainer>
  );
}

// ── Linha do tempo ───────────────────────────────────────────────────
function Event({ icon, title, meta, children }: { icon: ReactNode; title: ReactNode; meta: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {/* Linha vertical que liga os eventos. */}
      <span className="absolute bottom-0 left-4 top-8 w-px bg-border" aria-hidden />
      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-neutral-soft-text" aria-hidden>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-text">{title}</p>
          <p className="text-xs text-muted">{meta}</p>
        </div>
        {children}
      </div>
    </li>
  );
}

function Timeline({ dispute, submission, match }: { dispute: Dispute; submission: ResultSubmission | undefined; match: Match | undefined }) {
  const t = useT(messages, 'Timeline');
  const roles = useT(messages, 'DisputePage.papel');
  const [opening, ...rest] = dispute.messages;
  const official = match && (match.status === 'VALIDATED' || match.status === 'WALKOVER') ? match.participants.map((p) => `${p.name} ${p.score ?? 0}`).join(' x ') : null;
  const officialText = official ? t.rich('oficial', { resultado: official, strong: (chunks) => <strong className="tabular text-text">{chunks}</strong> }) : null;

  return (
    <ol className="flex flex-col" aria-label={t('historico')}>
      {submission && (
        <Event icon={<Upload className="size-4" />} title={t('enviado')} meta={`${submission.submittedByNickname} · ${formatDateTime(submission.createdAt)}`}>
          <p className="tabular text-lg font-bold text-text [overflow-wrap:anywhere]">{scoreLine(submission, match)}</p>
          <EvidenceGallery urls={submission.evidenceUrls} label={t('printEnvio')} />
        </Event>
      )}

      <Event icon={<AlertTriangle className="size-4" />} title={t('contestado')} meta={`${dispute.openedByNickname} · ${formatDateTime(dispute.createdAt)}`}>
        <p className="whitespace-pre-line text-sm text-text [overflow-wrap:anywhere]">{dispute.reason}</p>
        <EvidenceGallery urls={opening?.evidenceUrls ?? []} label={t('provaContestacao')} />
      </Event>

      {rest.map((m) => (
        <Event
          key={m.id}
          icon={<MessageSquare className="size-4" />}
          title={
            <>
              {m.authorNickname}
              <Badge tone={ROLE_TONE[m.authorRole]}>{roles(m.authorRole)}</Badge>
            </>
          }
          meta={formatDateTime(m.createdAt)}
        >
          <p className="whitespace-pre-line text-sm text-text [overflow-wrap:anywhere]">{m.body}</p>
          <EvidenceGallery urls={m.evidenceUrls} label={t('anexo')} />
        </Event>
      ))}

      {dispute.status === 'RESOLVED' && (
        <Event icon={<CheckCircle2 className="size-4" />} title={t('resolvida')} meta={dispute.resolvedAt ? formatDateTime(dispute.resolvedAt) : ''}>
          <p className="whitespace-pre-line text-sm text-text [overflow-wrap:anywhere]">{dispute.resolution}</p>
          {official ? (
            <p className="text-sm text-muted">{officialText}</p>
          ) : (
            <p className="text-sm text-muted">{t('nenhumResultado')}</p>
          )}
        </Event>
      )}
    </ol>
  );
}

// ── Mensagem ─────────────────────────────────────────────────────────
const MessageSchema = DisputeMessageInput.pick({ body: true });
type MessageValues = z.infer<typeof MessageSchema>;

function MessageBox({ disputeId }: { disputeId: string }) {
  const t = useT(messages, 'MessageBox');
  const send = useSendDisputeMessage(disputeId);
  const { success, error } = useToast();
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const form = useForm<MessageValues>({ resolver: zodResolver(MessageSchema), defaultValues: { body: '' } });

  const submit = form.handleSubmit(({ body }) => {
    send.mutate(
      { body, evidenceUrls },
      {
        onSuccess: () => {
          form.reset({ body: '' });
          setEvidenceUrls([]);
          success(t('enviada'));
        },
        onError: (e) => error(t('erro'), errorMessage(e)),
      },
    );
  });

  const bodyField = form.register('body');

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4" aria-labelledby="disputa-mensagem">
      <h2 id="disputa-mensagem" className="text-lg">
        {t('titulo')}
      </h2>
      <Textarea label={t('mensagem')} required rows={3} maxLength={1000} hint={t('mensagemDica')} error={form.formState.errors.body?.message} {...bodyField} />
      <EvidenceUpload label={t('anexos')} hint={t('anexosDica')} purpose="evidence" max={3} value={evidenceUrls} onChange={setEvidenceUrls} onBusyChange={setUploading} />
      <Button type="submit" className="self-start" loading={send.isPending} disabled={uploading} iconLeft={<Send className="size-4" aria-hidden />}>
        {t('enviar')}
      </Button>
    </form>
  );
}

// ── Ações do staff e da administração ────────────────────────────────
function StaffActions({ dispute, access, submission, match }: { dispute: Dispute; access: TournamentAccessLevel; submission: ResultSubmission | undefined; match: Match | undefined }) {
  const t = useT(messages, 'StaffActions');
  const [dialog, setDialog] = useState<'escalate' | 'resolve' | null>(null);
  const isAdmin = access === 'ADMIN';
  const canResolve = dispute.status === 'OPEN' || isAdmin;
  const canEscalate = dispute.status === 'OPEN' && !isAdmin;

  return (
    <Card>
      <section aria-labelledby="disputa-decisao" className="flex flex-col gap-3">
        <h2 id="disputa-decisao" className="text-lg">
          {t('titulo')}
        </h2>
        {canResolve ? (
          <p className="text-sm text-muted">
            {isAdmin ? t('admin') : t('organizacao')}
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('escalada')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canResolve && (
            <Button iconLeft={<Scale className="size-4" aria-hidden />} onClick={() => setDialog('resolve')}>
              {t('resolver')}
            </Button>
          )}
          {canEscalate && (
            <Button variant="secondary" iconLeft={<ShieldAlert className="size-4" aria-hidden />} onClick={() => setDialog('escalate')}>
              {t('escalar')}
            </Button>
          )}
        </div>
      </section>
      {dialog === 'escalate' && <EscalateDialog dispute={dispute} onClose={() => setDialog(null)} />}
      {dialog === 'resolve' && <ResolveDialog dispute={dispute} submission={submission} match={match} onClose={() => setDialog(null)} />}
    </Card>
  );
}
