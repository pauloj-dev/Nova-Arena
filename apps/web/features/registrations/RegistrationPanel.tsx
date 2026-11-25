'use client';

import type { Tournament } from '@nova/schemas';
import { Button, Card, ErrorState, Progress, Skeleton } from '@nova/ui';
import { CalendarClock, CalendarX2, Hourglass, Lock, ShieldCheck, XCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useMyRegistration, useRegistrationEligibility } from '@/shared/api/hooks/registrations';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { registrationPanelView } from './lib/rules';
import { messages } from './messages';

// Só quem está logado vê o formulário (squads, contas de jogo) e o cartão da inscrição: fora do JS inicial (#111).
const MyRegistrationCard = dynamic(() => import('./MyRegistrationCard').then((m) => m.MyRegistrationCard), { loading: () => <Skeleton className="h-32 w-full" /> });
const RegisterForm = dynamic(() => import('./RegisterForm').then((m) => m.RegisterForm), { loading: () => <Skeleton className="h-32 w-full" /> });

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-neutral-soft-text" aria-hidden>
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold text-text">{title}</p>
        {children && <div className="text-sm text-muted">{children}</div>}
      </div>
    </div>
  );
}

/**
 * Painel de inscrição da página do campeonato: mostra o estado certo para cada pessoa
 * (visitante, pode se inscrever, lista de espera, já inscrito, membro com confirmação pendente,
 * organização do campeonato, inscrições fechadas).
 */
export function RegistrationPanel({ tournament }: { tournament: Tournament }) {
  const { user, isLoading: sessionLoading } = useSession();
  const pathname = usePathname();
  const logged = Boolean(user);
  const mine = useMyRegistration(tournament.id, { enabled: logged });
  const eligibility = useRegistrationEligibility(tournament.id, { enabled: logged });
  const game = useGame(tournament.gameId);
  // A hora é lida uma vez ao montar: a regra que vale é a da API, aqui é só para escolher o que mostrar.
  const [now] = useState(() => new Date());
  const t = useT(messages, 'RegistrationPanel');

  const loading = sessionLoading || game.isPending || (logged && (mine.isPending || eligibility.isPending));
  const failed = game.error ?? (logged ? (mine.error ?? eligibility.error) : null);
  const free = Math.max(0, tournament.maxParticipants - tournament.takenSlots);

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (failed || !game.data) {
    body = (
      <ErrorState
        title={t('erroCarregar')}
        description={errorMessage(failed)}
        onRetry={() => {
          void game.refetch();
          if (logged) {
            void mine.refetch();
            void eligibility.refetch();
          }
        }}
      />
    );
  } else {
    const registration = logged ? (mine.data ?? null) : null;
    const requiresAccount = game.data.requiredAccountFields.length > 0;
    const hasAccount = Boolean(user?.gameAccounts.some((a) => a.gameId === tournament.gameId));
    const view = registrationPanelView({
      tournament,
      isAuthenticated: logged,
      hasRegistration: registration !== null,
      isOrganizer: eligibility.data?.isOrganizer ?? false,
      missingGameAccount: requiresAccount && !hasAccount,
      now,
    });
    const slots = (
      <div className="flex flex-col gap-1">
        <Progress value={tournament.takenSlots} max={tournament.maxParticipants} label={t('vagasOcupadas')} />
        <p className="text-sm text-muted">
          {free > 0 ? t('restam', { count: free }) : tournament.waitlistEnabled ? t('esgotadasComFila', { count: tournament.waitlistCount }) : t('esgotadas')}
        </p>
      </div>
    );
    const closes = tournament.registrationClosesAt ? <p className="text-sm text-muted">{t('inscricoesAte', { data: formatDateTime(tournament.registrationClosesAt) })}</p> : null;

    switch (view.kind) {
      case 'REGISTERED':
        body = registration && user ? <MyRegistrationCard tournament={tournament} registration={registration} viewerId={user.id} /> : null;
        break;
      case 'CANCELLED':
        body = (
          <Notice icon={<XCircle className="size-5" />} title={t('canceladoTitulo')}>
            {t('canceladoTexto')}
          </Notice>
        );
        break;
      case 'CLOSED':
        body = (
          <Notice icon={<Lock className="size-5" />} title={t('encerradasTitulo')}>
            {tournament.registrationClosesAt ? t('fecharamEm', { data: formatDateTime(tournament.registrationClosesAt) }) : t('naoRecebeMais')}
          </Notice>
        );
        break;
      case 'ORGANIZER':
        body = (
          <Notice icon={<ShieldCheck className="size-5" />} title={t('organizadorTitulo')}>
            {t('organizadorTexto')}
          </Notice>
        );
        break;
      case 'NOT_OPEN_YET':
        body = (
          <Notice icon={<CalendarClock className="size-5" />} title={t('naoAbriramTitulo')}>
            {view.opensAt ? t('abremEm', { data: formatDateTime(view.opensAt) }) : t('semDataAbertura')}
          </Notice>
        );
        break;
      case 'FULL':
        body = (
          <>
            {slots}
            <Notice icon={<Hourglass className="size-5" />} title={t('esgotadasTitulo')}>
              {t('semListaEspera')}
            </Notice>
          </>
        );
        break;
      case 'VISITOR':
        body = (
          <>
            {slots}
            {closes}
            <p className="text-sm text-text">{view.waitlist ? t('entreParaFila') : t('entreParaInscrever')}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="lg">
                <Link href={`/entrar?next=${encodeURIComponent(pathname)}`}>{view.waitlist ? t('entrarParaFila') : t('entrarParaInscrever')}</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href={`/cadastro?next=${encodeURIComponent(pathname)}`}>{t('criarConta')}</Link>
              </Button>
            </div>
          </>
        );
        break;
      case 'CAN_REGISTER': {
        // Evento "um só campeonato" (ADR-0005): avisa antes, em vez de deixar a pessoa bater no erro.
        const clash = eligibility.data?.eventConflict ?? null;
        if (clash) {
          body = (
            <Notice icon={<CalendarX2 className="size-5" />} title={t('eventoTitulo')}>
              <span data-testid="conflito-evento">
                {t.rich('eventoTexto', {
                  campeonato: clash.tournamentName,
                  evento: clash.eventName,
                  link: (chunks) => (
                    <Link href={`/c/${clash.slug}`} className="font-semibold text-text underline-offset-2 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </Notice>
          );
          break;
        }
        const waitlistOffer = view.waitlistPosition !== null ? t.rich('ofertaFila', { posicao: view.waitlistPosition, b: (chunks) => <strong>{chunks}</strong> }) : null;
        body = user ? (
          <>
            {slots}
            {closes}
            {view.waitlistPosition !== null && (
              <p className="rounded-md bg-info-soft p-3 text-sm text-info-soft-text" data-testid="waitlist-offer">
                {waitlistOffer}
              </p>
            )}
            <RegisterForm tournament={tournament} game={game.data} viewerId={user.id} waitlistPosition={view.waitlistPosition} missingGameAccount={view.missingGameAccount} />
          </>
        ) : null;
        break;
      }
    }
  }

  return (
    <Card>
      <section aria-labelledby={`inscricao-${tournament.id}`} className="flex flex-col gap-4">
        <h2 id={`inscricao-${tournament.id}`} className="text-lg">
          {t('titulo')}
        </h2>
        {body}
      </section>
    </Card>
  );
}
