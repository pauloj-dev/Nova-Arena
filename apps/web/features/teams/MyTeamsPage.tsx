'use client';

import type { Team } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@nova/ui';
import { Crown, Hourglass, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMyTeams } from '@/shared/api/hooks/teams';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useSession } from '@/shared/session/useSession';
import { invitePath, isInviteCodeShape, normalizeInviteCode } from './lib/rules';
import { ReceivedInvites } from './ReceivedInvites';
import { TeamFormModal } from './TeamFormModal';
import { TeamLogo } from './TeamLogo';

/** `/minha-conta/squads`: meus squads, convites recebidos e entrada por código. */
export function MyTeamsPage() {
  const { user } = useSession();
  const teams = useMyTeams({ enabled: Boolean(user) });
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const createButton = (
    <Button iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
      Criar squad
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title="Meus squads" description="Seu time fica salvo aqui e pode ser inscrito em quantos campeonatos quiser." actions={createButton} />

      <ReceivedInvites />

      <section aria-labelledby="lista-squads" className="flex flex-col gap-3">
        <h2 id="lista-squads" className="sr-only">
          Squads em que você está
        </h2>
        {teams.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Carregando seus squads">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : teams.isError ? (
          <ErrorState title="Não foi possível carregar seus squads" description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
        ) : teams.data.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title="Você ainda não está em nenhum squad"
            description="Crie o seu e convide os amigos, ou peça o link de convite ao capitão do seu time."
            action={createButton}
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teams.data.map((team) => (
              <li key={team.id}>
                <TeamCard team={team} viewerId={user?.id ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <JoinByCode />

      <TeamFormModal open={creating} onOpenChange={setCreating} onSaved={(team) => router.push(`/minha-conta/squads/${team.id}`)} />
    </PageContainer>
  );
}

function TeamCard({ team, viewerId }: { team: Team; viewerId: string | null }) {
  const isCaptain = team.captainId === viewerId;
  const count = team.members.length;
  return (
    <Card interactive padding="sm" className="relative flex items-center gap-3">
      <TeamLogo tag={team.tag} logoUrl={team.logoUrl} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="truncate text-base">
          {/* O link cobre o cartão inteiro, mas o nome acessível é só o do squad. */}
          <Link href={`/minha-conta/squads/${team.id}`} className="after:absolute after:inset-0 after:rounded-lg">
            {team.name}
          </Link>{' '}
          <span className="tabular text-xs text-muted">[{team.tag}]</span>
        </h3>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Users className="size-4" aria-hidden />
          {count === 1 ? '1 membro' : `${count} membros`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {isCaptain && (
            <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
              Você é o capitão
            </Badge>
          )}
          {isCaptain && team.pendingInvites.length > 0 && (
            <Badge tone="warning" icon={<Hourglass className="size-3.5" aria-hidden />}>
              {team.pendingInvites.length === 1 ? '1 convite pendente' : `${team.pendingInvites.length} convites pendentes`}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Quem recebeu só o código (sem o link) digita aqui e vai para a prévia do convite. */
function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | undefined>();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeInviteCode(code);
    if (!isInviteCodeShape(normalized)) {
      setProblem('O código tem 6 letras ou números.');
      return;
    }
    router.push(invitePath(normalized));
  }

  return (
    <Card>
      <section aria-labelledby="entrar-codigo" className="flex flex-col gap-3">
        <div>
          <h2 id="entrar-codigo" className="text-lg">
            Tenho um código de convite
          </h2>
          <p className="mt-1 text-sm text-muted">Digite o código de 6 caracteres que o capitão mandou.</p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 xs:flex-row xs:items-start">
          <Input
            label="Código do convite"
            hideLabel
            placeholder="ALFA42"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            inputClassName="uppercase tabular tracking-[0.2em]"
            className="xs:w-56"
            value={code}
            error={problem}
            onChange={(e) => {
              setCode(e.target.value);
              setProblem(undefined);
            }}
          />
          <Button type="submit" variant="secondary">
            Ver convite
          </Button>
        </form>
      </section>
    </Card>
  );
}
