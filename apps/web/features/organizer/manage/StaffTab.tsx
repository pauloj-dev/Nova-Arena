'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { StaffInput, type OrganizerTournamentDetail, type StaffRole, type TournamentStaff } from '@nova/schemas';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton, useToast } from '@nova/ui';
import { Crown, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAddStaff, useRemoveStaff, useTournamentStaff, useUpdateStaff } from '@/shared/api/hooks/organizer-ops';
import { formatDate } from '@/shared/lib/datetime';
import { permissionsOf } from '../operation/stageUtils';

export const STAFF_ROLE_INFO: Record<StaffRole, { label: string; description: string }> = {
  CO_ORGANIZER: { label: 'Co-organizador', description: 'Faz quase tudo: edita o campeonato, gera a chave, avança fases, envia comunicados, pausa e desclassifica. Só não cancela nem muda a equipe.' },
  MODERATOR: { label: 'Moderador', description: 'Ajuda no dia do evento: agenda partidas, lança e valida resultados e aprova ou recusa inscrições. Não mexe na chave nem no campeonato.' },
};
const ROLE_OPTIONS = (['MODERATOR', 'CO_ORGANIZER'] as const).map((value) => ({ value, label: STAFF_ROLE_INFO[value].label }));

/** Aba Equipe do evento (ORG-10): quem ajuda a organizar, com o papel de cada um. Só o responsável (ou o Admin) muda a equipe. */
export function StaffTab({ tournament: t }: { tournament: OrganizerTournamentDetail }) {
  const perms = permissionsOf(t.access);
  const query = useTournamentStaff(t.id);
  const add = useAddStaff(t.id);
  const update = useUpdateStaff(t.id);
  const remove = useRemoveStaff(t.id);
  const { success, error } = useToast();
  const [removing, setRemoving] = useState<TournamentStaff | null>(null);
  const form = useForm<StaffInput>({ resolver: zodResolver(StaffInput), defaultValues: { nickname: '', role: 'MODERATOR' } });
  const role = useWatch({ control: form.control, name: 'role' });
  const closed = t.status === 'ARCHIVED' || t.status === 'CANCELLED';
  const canEdit = perms.isOwner && !closed;

  function submit(input: StaffInput) {
    add.mutate(input, {
      onSuccess: (member) => {
        success(`${member.nickname} entrou na equipe`, `Como ${STAFF_ROLE_INFO[member.role].label.toLowerCase()}. A pessoa foi avisada.`);
        form.reset({ nickname: '', role: input.role });
      },
      onError: (e) => {
        if (e instanceof ApiError && e.fieldErrors.nickname) form.setError('nickname', { message: e.fieldErrors.nickname });
        else if (e instanceof ApiError && e.status === 409) form.setError('nickname', { message: errorMessage(e) });
        error('Não foi possível adicionar', errorMessage(e));
      },
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Equipe do evento</h2>
          <ul className="flex flex-col gap-2" aria-label="Equipe do evento">
            <li className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
              <Avatar name={t.organizer.nickname} src={t.organizer.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-text">{t.organizer.nickname}</span>
              <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
                Responsável
              </Badge>
            </li>
            {query.isPending && (
              <li role="status" aria-label="Carregando a equipe">
                <Skeleton className="h-14 w-full" />
              </li>
            )}
            {query.data?.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3" data-testid="staff-member">
                <Avatar name={member.nickname} src={member.avatarUrl} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-semibold text-text">{member.nickname}</span>
                  <span className="text-xs text-muted">na equipe desde {formatDate(member.addedAt)}</span>
                </span>
                {canEdit ? (
                  <>
                    <Select
                      className="w-44"
                      label={`Papel de ${member.nickname}`}
                      hideLabel
                      value={member.role}
                      disabled={update.isPending}
                      options={ROLE_OPTIONS}
                      onChange={(e) =>
                        update.mutate(
                          { userId: member.userId, role: e.target.value as StaffRole },
                          { onSuccess: (m) => success('Papel alterado', `${m.nickname} agora é ${STAFF_ROLE_INFO[m.role].label.toLowerCase()}.`), onError: (err) => error('Não foi possível mudar o papel', errorMessage(err)) },
                        )
                      }
                    />
                    <Button size="sm" variant="ghost" iconLeft={<UserMinus className="size-4" aria-hidden />} aria-label={`Remover ${member.nickname} da equipe`} onClick={() => setRemoving(member)}>
                      Remover
                    </Button>
                  </>
                ) : (
                  <Badge tone="accent" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
                    {STAFF_ROLE_INFO[member.role].label}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {query.error && <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
          {query.data?.length === 0 && <EmptyState icon={<Users className="size-7" />} title="Você está organizando sozinho" description={canEdit ? 'Adicione um moderador para ajudar a lançar resultados no dia do evento.' : 'Só o responsável pelo campeonato adiciona pessoas à equipe.'} />}
        </Card>

        {canEdit && (
          <Card>
            <form noValidate className="flex flex-col gap-4" aria-label="Adicionar à equipe" onSubmit={(event) => void form.handleSubmit(submit)(event)}>
              <h2 className="text-lg">Adicionar à equipe</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <Input label="Apelido na Nova Arena" required autoComplete="off" placeholder="Ex.: KaueFF01" hint="A pessoa precisa ter conta e não pode estar inscrita neste campeonato." error={form.formState.errors.nickname?.message} {...form.register('nickname')} />
                <Select label="Papel" options={ROLE_OPTIONS} hint={STAFF_ROLE_INFO[role].description} {...form.register('role')} />
              </div>
              <div>
                <Button type="submit" loading={add.isPending} iconLeft={<UserPlus className="size-4" aria-hidden />}>
                  Adicionar à equipe
                </Button>
              </div>
            </form>
          </Card>
        )}
        {!perms.isOwner && <p className="text-sm text-muted">Só o responsável pelo campeonato (ou a administração da Nova Arena) adiciona, remove ou muda o papel de alguém da equipe.</p>}
      </div>

      <Card className="flex h-fit flex-col gap-3">
        <h2 className="text-lg">O que cada papel pode</h2>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-semibold text-text">Responsável</dt>
            <dd className="text-muted">Tudo, inclusive publicar, cancelar e montar a equipe.</dd>
          </div>
          {ROLE_OPTIONS.map((option) => (
            <div key={option.value}>
              <dt className="font-semibold text-text">{option.label}</dt>
              <dd className="text-muted">{STAFF_ROLE_INFO[option.value].description}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title={removing ? `Remover ${removing.nickname} da equipe?` : 'Remover da equipe'}
        description="A pessoa perde o acesso à gestão deste campeonato na hora e é avisada."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.userId, {
                  onSuccess: () => {
                    success(`${removing.nickname} saiu da equipe`);
                    setRemoving(null);
                  },
                  onError: (e) => error('Não foi possível remover', errorMessage(e)),
                });
              }}
            >
              Remover da equipe
            </Button>
          </>
        }
      />
    </div>
  );
}
