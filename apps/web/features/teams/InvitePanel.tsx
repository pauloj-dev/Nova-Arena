'use client';

import type { InviteCandidate, Team, TeamInvite } from '@nova/schemas';
import { Avatar, Button, ErrorState, Input, Skeleton, useToast } from '@nova/ui';
import { Check, Copy, Link2, RefreshCw, Share2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCreateTeamInvite, useUserSearch } from '@/shared/api/hooks/teams';
import { formatDateTime } from '@/shared/lib/datetime';
import { invitePath } from './lib/rules';
import { absoluteUrl, copyText, shareInvite, useCanShare } from './lib/share';
import { useDebounced } from './lib/useDebounced';

/** Painel do capitão: convidar por apelido ou por link/código (vale 72 h). */
export function InvitePanel({ team }: { team: Team }) {
  return (
    <div className="flex flex-col gap-6">
      <InviteByNickname team={team} />
      <InviteByLink team={team} />
    </div>
  );
}

function InviteByNickname({ team }: { team: Team }) {
  const { success, error } = useToast();
  const [text, setText] = useState('');
  const term = useDebounced(text.trim());
  const search = useUserSearch(term);
  const invite = useCreateTeamInvite(team.id);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const memberIds = new Set(team.members.map((m) => m.userId));
  const invitedIds = new Set(team.pendingInvites.map((i) => i.invitedUserId).filter((id): id is string => id !== null));

  function send(candidate: InviteCandidate) {
    setInvitingId(candidate.id);
    invite.mutate(
      { kind: 'nickname', nickname: candidate.nickname },
      {
        onSuccess: () => success(`Convite enviado para ${candidate.nickname}`, 'Ele vale por 72 horas.'),
        onError: (e) => error(`Não foi possível convidar ${candidate.nickname}`, errorMessage(e)),
        onSettled: () => setInvitingId(null),
      },
    );
  }

  return (
    <section aria-labelledby={`convidar-apelido-${team.id}`} className="flex flex-col gap-3">
      <h3 id={`convidar-apelido-${team.id}`} className="text-base font-bold">
        Convidar por apelido
      </h3>
      <Input
        label="Apelido do jogador"
        type="search"
        placeholder="Digite pelo menos 2 letras"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div aria-live="polite">
        {term.length < 2 ? null : search.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Buscando jogadores">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : search.isError ? (
          <ErrorState title="Não foi possível buscar" description={errorMessage(search.error)} onRetry={() => void search.refetch()} />
        ) : search.data.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-sm text-muted">
            Nenhum jogador com “{term}”. Confira o apelido ou mande o link de convite.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Jogadores encontrados">
            {search.data.map((candidate) => {
              const isMember = memberIds.has(candidate.id);
              const isInvited = invitedIds.has(candidate.id);
              return (
                <li key={candidate.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={candidate.nickname} src={candidate.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium">{candidate.nickname}</span>
                  {isMember ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                      <Check className="size-3.5" aria-hidden /> Já no squad
                    </span>
                  ) : isInvited ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                      <Check className="size-3.5" aria-hidden /> Convidado
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={invitingId === candidate.id}
                      disabled={invite.isPending}
                      iconLeft={<UserPlus className="size-4" aria-hidden />}
                      aria-label={`Convidar ${candidate.nickname}`}
                      onClick={() => send(candidate)}
                    >
                      Convidar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function InviteByLink({ team }: { team: Team }) {
  const { success, error } = useToast();
  const create = useCreateTeamInvite(team.id);
  const canShare = useCanShare();
  // O link mais novo entre os ativos. Os outros continuam valendo e aparecem em "Convites pendentes".
  const current: TeamInvite | undefined = team.pendingInvites.filter((i) => i.invitedUserId === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const link = current ? absoluteUrl(invitePath(current.code)) : '';

  function generate() {
    create.mutate({ kind: 'link' }, { onSuccess: () => success('Link de convite criado', 'Ele vale por 72 horas.'), onError: (e) => error('Não foi possível criar o link', errorMessage(e)) });
  }
  async function copy(value: string, what: string) {
    if (await copyText(value)) success(`${what} copiado`);
    else error(`Não foi possível copiar o ${what.toLowerCase()}`, 'Selecione o texto e copie manualmente.');
  }
  async function share(invite: TeamInvite) {
    await shareInvite({
      title: `Convite para o ${team.name}`,
      text: `Entre no meu squad ${team.name} [${team.tag}] na Nova Arena. Código: ${invite.code}`,
      url: link,
    });
  }

  return (
    <section aria-labelledby={`convidar-link-${team.id}`} className="flex flex-col gap-3">
      <h3 id={`convidar-link-${team.id}`} className="text-base font-bold">
        Convidar por link ou código
      </h3>
      {!current ? (
        <>
          <p className="text-sm text-muted">Gere um link para mandar no grupo do time. Quem abrir o link (ou digitar o código) entra no squad. Vale por 72 horas.</p>
          <Button variant="secondary" loading={create.isPending} iconLeft={<Link2 className="size-4" aria-hidden />} onClick={generate} className="self-start">
            Gerar link de convite
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Código</span>
            <span className="tabular text-xl tracking-[0.3em] text-text" data-testid="invite-code">
              {current.code}
            </span>
            <span className="text-xs text-muted">Vale até {formatDateTime(current.expiresAt)}. Qualquer pessoa com o link ou o código entra no squad.</span>
          </div>
          <Input label="Link do convite" value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(link, 'Link')}>
              Copiar link
            </Button>
            <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(current.code, 'Código')}>
              Copiar código
            </Button>
            {canShare && (
              <Button size="sm" iconLeft={<Share2 className="size-4" aria-hidden />} onClick={() => void share(current)}>
                Compartilhar
              </Button>
            )}
            <Button variant="ghost" size="sm" loading={create.isPending} iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={generate}>
              Gerar outro link
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
