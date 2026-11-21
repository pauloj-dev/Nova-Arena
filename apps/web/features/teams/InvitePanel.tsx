'use client';

import type { InviteCandidate, Team, TeamInvite } from '@nova/schemas';
import { Avatar, Button, ErrorState, Input, Skeleton, useToast } from '@nova/ui';
import { Check, Copy, Link2, RefreshCw, Share2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCreateTeamInvite, useUserSearch } from '@/shared/api/hooks/teams';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { invitePath } from './lib/rules';
import { absoluteUrl, copyText, shareInvite, useCanShare } from './lib/share';
import { useDebounced } from './lib/useDebounced';
import { messages } from './messages';

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
  const t = useT(messages, 'InviteByNickname');

  const memberIds = new Set(team.members.map((m) => m.userId));
  const invitedIds = new Set(team.pendingInvites.map((i) => i.invitedUserId).filter((id): id is string => id !== null));

  function send(candidate: InviteCandidate) {
    setInvitingId(candidate.id);
    invite.mutate(
      { kind: 'nickname', nickname: candidate.nickname },
      {
        onSuccess: () => success(t('enviado', { nome: candidate.nickname }), t('vale72h')),
        onError: (e) => error(t('erroConvidar', { nome: candidate.nickname }), errorMessage(e)),
        onSettled: () => setInvitingId(null),
      },
    );
  }

  return (
    <section aria-labelledby={`convidar-apelido-${team.id}`} className="flex flex-col gap-3">
      <h3 id={`convidar-apelido-${team.id}`} className="text-base font-bold">
        {t('titulo')}
      </h3>
      <Input
        label={t('apelido')}
        type="search"
        placeholder={t('apelidoPlaceholder')}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div aria-live="polite">
        {term.length < 2 ? null : search.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label={t('buscando')}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : search.isError ? (
          <ErrorState title={t('erroBuscar')} description={errorMessage(search.error)} onRetry={() => void search.refetch()} />
        ) : search.data.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-sm text-muted">
            {t('nenhumJogador', { termo: term })}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label={t('encontrados')}>
            {search.data.map((candidate) => {
              const isMember = memberIds.has(candidate.id);
              const isInvited = invitedIds.has(candidate.id);
              return (
                <li key={candidate.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={candidate.nickname} src={candidate.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium">{candidate.nickname}</span>
                  {isMember ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                      <Check className="size-3.5" aria-hidden /> {t('jaNoSquad')}
                    </span>
                  ) : isInvited ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                      <Check className="size-3.5" aria-hidden /> {t('convidado')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={invitingId === candidate.id}
                      disabled={invite.isPending}
                      iconLeft={<UserPlus className="size-4" aria-hidden />}
                      aria-label={t('convidarNome', { nome: candidate.nickname })}
                      onClick={() => send(candidate)}
                    >
                      {t('convidar')}
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
  const t = useT(messages, 'InviteByLink');
  // O link mais novo entre os ativos. Os outros continuam valendo e aparecem em "Convites pendentes".
  const current: TeamInvite | undefined = team.pendingInvites.filter((i) => i.invitedUserId === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const link = current ? absoluteUrl(invitePath(current.code)) : '';

  function generate() {
    create.mutate({ kind: 'link' }, { onSuccess: () => success(t('criado'), t('vale72h')), onError: (e) => error(t('erroCriar'), errorMessage(e)) });
  }
  async function copy(value: string, what: 'link' | 'codigo') {
    if (await copyText(value)) success(t('copiado', { oque: what }));
    else error(t('erroCopiar', { oque: what }), t('copieManualmente'));
  }
  async function share(invite: TeamInvite) {
    await shareInvite({
      title: t('compartilharTitulo', { nome: team.name }),
      text: t('compartilharTexto', { nome: team.name, tag: team.tag, codigo: invite.code }),
      url: link,
    });
  }

  return (
    <section aria-labelledby={`convidar-link-${team.id}`} className="flex flex-col gap-3">
      <h3 id={`convidar-link-${team.id}`} className="text-base font-bold">
        {t('titulo')}
      </h3>
      {!current ? (
        <>
          <p className="text-sm text-muted">{t('gereUmLink')}</p>
          <Button variant="secondary" loading={create.isPending} iconLeft={<Link2 className="size-4" aria-hidden />} onClick={generate} className="self-start">
            {t('gerarLink')}
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('codigo')}</span>
            <span className="tabular text-xl tracking-[0.3em] text-text" data-testid="invite-code">
              {current.code}
            </span>
            <span className="text-xs text-muted">{t('valeAte', { data: formatDateTime(current.expiresAt) })}</span>
          </div>
          <Input label={t('linkDoConvite')} value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(link, 'link')}>
              {t('copiarLink')}
            </Button>
            <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(current.code, 'codigo')}>
              {t('copiarCodigo')}
            </Button>
            {canShare && (
              <Button size="sm" iconLeft={<Share2 className="size-4" aria-hidden />} onClick={() => void share(current)}>
                {t('compartilhar')}
              </Button>
            )}
            <Button variant="ghost" size="sm" loading={create.isPending} iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={generate}>
              {t('gerarOutro')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
