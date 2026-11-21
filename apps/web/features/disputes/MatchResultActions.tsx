'use client';

import type { Match, Registration, ResultSubmission } from '@nova/schemas';
import { Button, useToast } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Hourglass, Send, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useConfirmSubmission, useMatchSubmission, useMyDisputes } from '@/shared/api/hooks/disputes';
import { useMyRegistration } from '@/shared/api/hooks/registrations';
import { formatTime } from '@/shared/lib/datetime';
import { useFlag } from '@/shared/flags/useFlag';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { ContestDialog } from './ContestDialog';
import { EvidenceGallery } from './evidence/EvidenceGallery';
import { scoreLine, sidesOf } from './scoreForm';
import { SubmitResultDialog } from './SubmitResultDialog';
import { useNow } from './useNow';
import { messages } from './messages';

/** Status em que a partida ainda pode receber (ou está recebendo) resultado dos participantes. */
const OPEN_STATUSES: Match['status'][] = ['SCHEDULED', 'CHECK_IN', 'LIVE', 'AWAITING_VALIDATION', 'DISPUTED'];

/** Quem responde pela inscrição: o jogador solo ou o capitão do squad. */
function actsFor(registration: Registration, userId: string): boolean {
  if (registration.userId) return registration.userId === userId;
  return registration.members.some((m) => m.userId === userId && m.isCaptain);
}

/** Placar em destaque dentro de um aviso (`<strong>` dos textos do catálogo). */
const strong = (chunks: ReactNode) => <strong className="tabular text-text">{chunks}</strong>;

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

/**
 * Ações de resultado do participante em uma partida: enviar placar com print,
 * confirmar ou contestar o que o adversário enviou, e acompanhar a disputa.
 * Não renderiza nada para quem não joga a partida (nem para quedas de Battle Royale,
 * que são lançadas pela organização).
 */
export function MatchResultActions({ match }: { match: Match }) {
  const t = useT(messages, 'MatchResultActions');
  const { user } = useSession();
  // O envio pelo participante pode ser desligado nas configurações do site (flag `resultSubmission`).
  const enabled = useFlag('resultSubmission');
  const sides = sidesOf(match);
  const candidate = enabled && Boolean(user) && match.kind === 'DUEL' && sides !== null && OPEN_STATUSES.includes(match.status);
  const registration = useMyRegistration(match.tournamentId, { enabled: candidate });
  const mine = registration.data && registration.data.status === 'CONFIRMED' && match.participants.some((p) => p.registrationId === registration.data?.id) ? registration.data : null;
  const plays = candidate && mine !== null;
  const disputed = match.status === 'DISPUTED';
  const submission = useMatchSubmission(match.id, plays && !disputed);
  const disputes = useMyDisputes(plays && disputed);
  const confirm = useConfirmSubmission();
  const { success, error } = useToast();
  const [dialog, setDialog] = useState<'submit' | 'contest' | null>(null);
  // O prazo de resposta vence com a tela aberta: reavalia de tempos em tempos.
  const now = useNow(15_000, submission.data?.status === 'PENDING');

  if (!user || !plays || !mine || !sides) return null;
  const canAct = actsFor(mine, user.id);

  if (disputed) {
    const dispute = disputes.data?.find((d) => d.matchId === match.id && d.status !== 'RESOLVED');
    return (
      <div className="flex flex-col gap-2" data-testid="match-result-actions">
        <Notice icon={<AlertTriangle className="size-4 text-warning-soft-text" />}>{t('emDisputa')}</Notice>
        {dispute && (
          <Button asChild variant="secondary" size="sm" className="self-start">
            <Link href={`/disputas/${dispute.id}`}>{t('acompanhar')}</Link>
          </Button>
        )}
      </div>
    );
  }

  if (submission.isPending) return null;
  const sent: ResultSubmission | null = submission.data ?? null;

  if (!sent) {
    // A partida diz "aguardando validação" mas não há envio visível: nada a fazer por aqui.
    if (match.status === 'AWAITING_VALIDATION') return null;
    return (
      <div className="flex flex-col gap-2" data-testid="match-result-actions">
        {canAct ? (
          <Button size="sm" className="self-start" iconLeft={<Send className="size-4" aria-hidden />} onClick={() => setDialog('submit')}>
            {t('enviar')}
          </Button>
        ) : (
          <Notice icon={<ShieldQuestion className="size-4" />}>{t('capitaoEnvia')}</Notice>
        )}
        {dialog === 'submit' && <SubmitResultDialog match={match} sides={sides} mineRegistrationId={mine.id} onClose={() => setDialog(null)} />}
      </div>
    );
  }

  const summary = scoreLine(sent, match);
  const sentByMe = sent.submittedByRegistrationId === mine.id;
  const expired = new Date(sent.respondBy).getTime() <= now;
  const deadline = formatTime(sent.respondBy);

  if (sent.status === 'CONFIRMED') {
    const agreed = t.rich('concordam', { resumo: summary, strong });
    return (
      <div data-testid="match-result-actions">
        <Notice icon={<CheckCircle2 className="size-4 text-primary-text" />}>
          {agreed}
        </Notice>
      </div>
    );
  }

  if (sent.status === 'CONTESTED') {
    return (
      <div data-testid="match-result-actions">
        <Notice icon={<AlertTriangle className="size-4 text-warning-soft-text" />}>{t('contestado')}</Notice>
      </div>
    );
  }

  if (sentByMe) {
    const mineSent = t.rich('enviou', { quem: canAct ? 'voce' : 'squad', resumo: summary, strong });
    return (
      <div data-testid="match-result-actions">
        <Notice icon={<Hourglass className="size-4" />}>
          {mineSent}{' '}
          {expired ? t('semRespostaNoPrazo') : t('aguardandoAdversario', { prazo: deadline })}
        </Notice>
      </div>
    );
  }

  function confirmResult(submissionId: string) {
    confirm.mutate(submissionId, {
      onSuccess: () => success(t('confirmadoTitulo'), t('confirmadoDescricao')),
      onError: (e) => error(t('erroConfirmar'), errorMessage(e)),
    });
  }

  const theirSent = t.rich('adversarioEnviou', { nick: sent.submittedByNickname, resumo: summary, strong });

  return (
    <div className="flex flex-col gap-2" data-testid="match-result-actions">
      <Notice icon={<Hourglass className="size-4" />}>
        {theirSent}{' '}
        {expired ? t('prazoTerminou') : canAct ? t('confirmeAte', { prazo: deadline }) : t('capitaoConfirmaAte', { prazo: deadline })}
      </Notice>
      <EvidenceGallery urls={sent.evidenceUrls} label={t('printAdversario')} />
      {canAct && !expired && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={confirm.isPending} iconLeft={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => confirmResult(sent.id)}>
            {t('confirmar')}
          </Button>
          <Button size="sm" variant="secondary" disabled={confirm.isPending} iconLeft={<AlertTriangle className="size-4" aria-hidden />} onClick={() => setDialog('contest')}>
            {t('contestar')}
          </Button>
        </div>
      )}
      {dialog === 'contest' && <ContestDialog submission={sent} summary={summary} onClose={() => setDialog(null)} />}
    </div>
  );
}
