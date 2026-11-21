'use client';

import type { Team } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@nova/ui';
import { Crown, Hourglass, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMyTeams } from '@/shared/api/hooks/teams';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useSession } from '@/shared/session/useSession';
import { invitePath, isInviteCodeShape, normalizeInviteCode } from './lib/rules';
import { messages } from './messages';
import { ReceivedInvites } from './ReceivedInvites';
import { TeamFormModal } from './TeamFormModal';
import { TeamLogo } from './TeamLogo';

/** `/minha-conta/squads`: meus squads, convites recebidos e entrada por código. */
export function MyTeamsPage() {
  const { user } = useSession();
  const teams = useMyTeams({ enabled: Boolean(user) });
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const t = useT(messages, 'MyTeamsPage');

  const createButton = (
    <Button iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
      {t('criarSquad')}
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} actions={createButton} />

      <ReceivedInvites />

      <section aria-labelledby="lista-squads" className="flex flex-col gap-3">
        <h2 id="lista-squads" className="sr-only">
          {t('squadsEmQueVoceEsta')}
        </h2>
        {teams.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('carregando')}>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : teams.isError ? (
          <ErrorState title={t('erroCarregar')} description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
        ) : teams.data.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title={t('vazioTitulo')}
            description={t('vazioDescricao')}
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
  const t = useT(messages, 'TeamCard');
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
          {t('membros', { count })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {isCaptain && (
            <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
              {t('voceEhCapitao')}
            </Badge>
          )}
          {isCaptain && team.pendingInvites.length > 0 && (
            <Badge tone="warning" icon={<Hourglass className="size-3.5" aria-hidden />}>
              {t('convitesPendentes', { count: team.pendingInvites.length })}
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
  const t = useT(messages, 'JoinByCode');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeInviteCode(code);
    if (!isInviteCodeShape(normalized)) {
      setProblem(t('codigoInvalido'));
      return;
    }
    router.push(invitePath(normalized));
  }

  return (
    <Card>
      <section aria-labelledby="entrar-codigo" className="flex flex-col gap-3">
        <div>
          <h2 id="entrar-codigo" className="text-lg">
            {t('titulo')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('descricao')}</p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 xs:flex-row xs:items-start">
          <Input
            label={t('codigoDoConvite')}
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
            {t('verConvite')}
          </Button>
        </form>
      </section>
    </Card>
  );
}
