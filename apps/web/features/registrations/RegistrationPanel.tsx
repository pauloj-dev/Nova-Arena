'use client';

import type { Tournament } from '@nova/schemas';
import { Button, Card, ErrorState, Progress, Skeleton } from '@nova/ui';
import { CalendarClock, Hourglass, Lock, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useMyRegistration, useRegistrationEligibility } from '@/shared/api/hooks/registrations';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { registrationPanelView } from './lib/rules';
import { MyRegistrationCard } from './MyRegistrationCard';
import { RegisterForm } from './RegisterForm';

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

  const loading = sessionLoading || game.isPending || (logged && (mine.isPending || eligibility.isPending));
  const failed = game.error ?? (logged ? (mine.error ?? eligibility.error) : null);
  const free = Math.max(0, tournament.maxParticipants - tournament.takenSlots);

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando a inscrição">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (failed || !game.data) {
    body = (
      <ErrorState
        title="Não foi possível carregar a inscrição"
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
        <Progress value={tournament.takenSlots} max={tournament.maxParticipants} label="Vagas ocupadas" />
        <p className="text-sm text-muted">
          {free > 0
            ? free === 1
              ? 'Resta 1 vaga.'
              : `Restam ${free} vagas.`
            : tournament.waitlistEnabled
              ? `Vagas esgotadas. ${tournament.waitlistCount === 0 ? 'Ninguém na lista de espera ainda.' : tournament.waitlistCount === 1 ? '1 inscrição na lista de espera.' : `${tournament.waitlistCount} inscrições na lista de espera.`}`
              : 'Vagas esgotadas.'}
        </p>
      </div>
    );
    const closes = tournament.registrationClosesAt ? <p className="text-sm text-muted">Inscrições até {formatDateTime(tournament.registrationClosesAt)}.</p> : null;

    switch (view.kind) {
      case 'REGISTERED':
        body = registration && user ? <MyRegistrationCard tournament={tournament} registration={registration} viewerId={user.id} /> : null;
        break;
      case 'CANCELLED':
        body = (
          <Notice icon={<XCircle className="size-5" />} title="Campeonato cancelado">
            Este campeonato foi cancelado pela organização e não recebe inscrições.
          </Notice>
        );
        break;
      case 'CLOSED':
        body = (
          <Notice icon={<Lock className="size-5" />} title="Inscrições encerradas">
            {tournament.registrationClosesAt ? `As inscrições fecharam em ${formatDateTime(tournament.registrationClosesAt)}.` : 'Este campeonato não recebe mais inscrições.'}
          </Notice>
        );
        break;
      case 'ORGANIZER':
        body = (
          <Notice icon={<ShieldCheck className="size-5" />} title="Você organiza este campeonato">
            Quem é da organização (dono, co-organizador ou moderador) não pode se inscrever no próprio campeonato. Para jogar, entre em um campeonato de outro organizador.
          </Notice>
        );
        break;
      case 'NOT_OPEN_YET':
        body = (
          <Notice icon={<CalendarClock className="size-5" />} title="As inscrições ainda não abriram">
            {view.opensAt ? `Elas abrem em ${formatDateTime(view.opensAt)}.` : 'A organização ainda não marcou a data de abertura.'}
          </Notice>
        );
        break;
      case 'FULL':
        body = (
          <>
            {slots}
            <Notice icon={<Hourglass className="size-5" />} title="Vagas esgotadas">
              Este campeonato não tem lista de espera.
            </Notice>
          </>
        );
        break;
      case 'VISITOR':
        body = (
          <>
            {slots}
            {closes}
            <p className="text-sm text-text">{view.waitlist ? 'Entre na sua conta para entrar na lista de espera.' : 'Entre na sua conta para se inscrever.'}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="lg">
                <Link href={`/entrar?next=${encodeURIComponent(pathname)}`}>{view.waitlist ? 'Entrar para pegar um lugar na fila' : 'Entrar para se inscrever'}</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href={`/cadastro?next=${encodeURIComponent(pathname)}`}>Criar conta</Link>
              </Button>
            </div>
          </>
        );
        break;
      case 'CAN_REGISTER':
        body = user ? (
          <>
            {slots}
            {closes}
            {view.waitlistPosition !== null && (
              <p className="rounded-md bg-info-soft p-3 text-sm text-info-soft-text" data-testid="waitlist-offer">
                Você pode entrar na lista de espera. Hoje você seria o <strong>{view.waitlistPosition}º da fila</strong>; se alguém cancelar, a vaga passa para o primeiro, automaticamente.
              </p>
            )}
            <RegisterForm tournament={tournament} game={game.data} viewerId={user.id} waitlistPosition={view.waitlistPosition} missingGameAccount={view.missingGameAccount} />
          </>
        ) : null;
        break;
    }
  }

  return (
    <Card>
      <section aria-labelledby={`inscricao-${tournament.id}`} className="flex flex-col gap-4">
        <h2 id={`inscricao-${tournament.id}`} className="text-lg">
          Inscrição
        </h2>
        {body}
      </section>
    </Card>
  );
}
