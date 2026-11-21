'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { StaffInput, type OrganizerTournamentDetail, type StaffRole, type TournamentStaff } from '@nova/schemas';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton, useToast } from '@nova/ui';
import { Crown, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAddStaff, useRemoveStaff, useTournamentStaff, useUpdateStaff } from '@/shared/api/hooks/organizer-ops';
import { useT } from '@/shared/i18n/react';
import { formatDate } from '@/shared/lib/datetime';
import { permissionsOf } from '../operation/stageUtils';
import { messages } from './messages';

/** Chave das mensagens de cada papel (rótulo e descrição em `StaffTab.papeis`). */
const ROLE_KEY = { CO_ORGANIZER: 'coOrganizador', MODERATOR: 'moderador' } as const satisfies Record<StaffRole, string>;
const ROLES = ['MODERATOR', 'CO_ORGANIZER'] as const;

/** Aba Equipe do evento (ORG-10): quem ajuda a organizar, com o papel de cada um. Só o responsável (ou o Admin) muda a equipe. */
export function StaffTab({ tournament }: { tournament: OrganizerTournamentDetail }) {
  const t = useT(messages, 'StaffTab');
  const roleLabel = (r: StaffRole) => t(`papeis.${ROLE_KEY[r]}.rotulo`);
  const roleDescription = (r: StaffRole) => t(`papeis.${ROLE_KEY[r]}.descricao`);
  const roleOptions = ROLES.map((value) => ({ value, label: roleLabel(value) }));
  const perms = permissionsOf(tournament.access);
  const query = useTournamentStaff(tournament.id);
  const add = useAddStaff(tournament.id);
  const update = useUpdateStaff(tournament.id);
  const remove = useRemoveStaff(tournament.id);
  const { success, error } = useToast();
  const [removing, setRemoving] = useState<TournamentStaff | null>(null);
  const form = useForm<StaffInput>({ resolver: zodResolver(StaffInput), defaultValues: { nickname: '', role: 'MODERATOR' } });
  const role = useWatch({ control: form.control, name: 'role' });
  const closed = tournament.status === 'ARCHIVED' || tournament.status === 'CANCELLED';
  const canEdit = perms.isOwner && !closed;

  function submit(input: StaffInput) {
    add.mutate(input, {
      onSuccess: (member) => {
        success(t('entrou', { nome: member.nickname }), t('entrouDescricao', { papel: member.role }));
        form.reset({ nickname: '', role: input.role });
      },
      onError: (e) => {
        if (e instanceof ApiError && e.fieldErrors.nickname) form.setError('nickname', { message: e.fieldErrors.nickname });
        else if (e instanceof ApiError && e.status === 409) form.setError('nickname', { message: errorMessage(e) });
        error(t('erroAdicionar'), errorMessage(e));
      },
    });
  }

  const nicknameField = form.register('nickname');
  const roleField = form.register('role');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('titulo')}</h2>
          <ul className="flex flex-col gap-2" aria-label={t('titulo')}>
            <li className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
              <Avatar name={tournament.organizer.nickname} src={tournament.organizer.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-text">{tournament.organizer.nickname}</span>
              <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
                {t('responsavel')}
              </Badge>
            </li>
            {query.isPending && (
              <li role="status" aria-label={t('carregando')}>
                <Skeleton className="h-14 w-full" />
              </li>
            )}
            {query.data?.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3" data-testid="staff-member">
                <Avatar name={member.nickname} src={member.avatarUrl} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-semibold text-text">{member.nickname}</span>
                  <span className="text-xs text-muted">{t('desde', { data: formatDate(member.addedAt) })}</span>
                </span>
                {canEdit ? (
                  <>
                    <Select
                      className="w-44"
                      label={t('papelDe', { nome: member.nickname })}
                      hideLabel
                      value={member.role}
                      disabled={update.isPending}
                      options={roleOptions}
                      onChange={(e) =>
                        update.mutate(
                          { userId: member.userId, role: e.target.value as StaffRole },
                          { onSuccess: (m) => success(t('papelAlterado'), t('papelAlteradoDescricao', { nome: m.nickname, papel: m.role })), onError: (err) => error(t('erroPapel'), errorMessage(err)) },
                        )
                      }
                    />
                    <Button size="sm" variant="ghost" iconLeft={<UserMinus className="size-4" aria-hidden />} aria-label={t('removerRotulo', { nome: member.nickname })} onClick={() => setRemoving(member)}>
                      {t('remover')}
                    </Button>
                  </>
                ) : (
                  <Badge tone="accent" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
                    {roleLabel(member.role)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {query.error && <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
          {query.data?.length === 0 && <EmptyState icon={<Users className="size-7" />} title={t('sozinhoTitulo')} description={canEdit ? t('sozinhoDescricaoResponsavel') : t('sozinhoDescricao')} />}
        </Card>

        {canEdit && (
          <Card>
            <form noValidate className="flex flex-col gap-4" aria-label={t('adicionar')} onSubmit={(event) => void form.handleSubmit(submit)(event)}>
              <h2 className="text-lg">{t('adicionar')}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <Input label={t('apelido')} required autoComplete="off" placeholder={t('apelidoExemplo')} hint={t('apelidoDica')} error={form.formState.errors.nickname?.message} {...nicknameField} />
                <Select label={t('papel')} options={roleOptions} hint={roleDescription(role)} {...roleField} />
              </div>
              <div>
                <Button type="submit" loading={add.isPending} iconLeft={<UserPlus className="size-4" aria-hidden />}>
                  {t('adicionar')}
                </Button>
              </div>
            </form>
          </Card>
        )}
        {!perms.isOwner && <p className="text-sm text-muted">{t('soResponsavel')}</p>}
      </div>

      <Card className="flex h-fit flex-col gap-3">
        <h2 className="text-lg">{t('oQuePode')}</h2>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-semibold text-text">{t('responsavel')}</dt>
            <dd className="text-muted">{t('responsavelPode')}</dd>
          </div>
          {roleOptions.map((option) => (
            <div key={option.value}>
              <dt className="font-semibold text-text">{option.label}</dt>
              <dd className="text-muted">{roleDescription(option.value)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title={removing ? t('removerTitulo', { nome: removing.nickname }) : t('removerDaEquipe')}
        description={t('removerDescricao')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('voltar')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.userId, {
                  onSuccess: () => {
                    success(t('saiu', { nome: removing.nickname }));
                    setRemoving(null);
                  },
                  onError: (e) => error(t('erroRemover'), errorMessage(e)),
                });
              }}
            >
              {t('removerDaEquipe')}
            </Button>
          </>
        }
      />
    </div>
  );
}
