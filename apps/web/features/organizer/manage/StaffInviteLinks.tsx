'use client';

import type { CreateStaffInviteInput, StaffRole, TournamentStaffInvite } from '@nova/schemas';
import { Button, Card, ErrorState, Input, Select, Skeleton, useToast } from '@nova/ui';
import { ClipboardCopy, Link2, Link2Off } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCreateStaffInvite, useRevokeStaffInvite, useStaffInvites } from '@/shared/api/hooks/organizer-ops';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from './messages';

const VALIDITIES = ['24h', '7d', '1h'] as const satisfies readonly CreateStaffInviteInput['validity'][];
const USES = [1, 2, 3, 5, 10] as const;

/**
 * Convite por link para a equipe do evento (ORG-10): o responsável escolhe o papel, a validade e quantas pessoas
 * podem usar, gera o link e manda para quem vai ajudar. O link completo só aparece na hora em que é criado.
 */
export function StaffInviteLinks({ tournamentId, roleOptions }: { tournamentId: string; roleOptions: { value: StaffRole; label: string }[] }) {
  const t = useT(messages, 'StaffTab.link');
  const { success, error } = useToast();
  const invites = useStaffInvites(tournamentId);
  const create = useCreateStaffInvite(tournamentId);
  const revoke = useRevokeStaffInvite(tournamentId);
  const [role, setRole] = useState<StaffRole>('MODERATOR');
  const [validity, setValidity] = useState<CreateStaffInviteInput['validity']>('24h');
  const [maxUses, setMaxUses] = useState<number>(1);
  const [created, setCreated] = useState<TournamentStaffInvite | null>(null);
  const active = invites.data?.filter((i) => i.state === 'VALID') ?? [];

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      success(t('copiado'));
    } catch {
      error(t('erroCopiar'), t('erroCopiarDescricao'));
    }
  }

  return (
    <Card className="flex flex-col gap-4" data-testid="staff-invite-links">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">{t('titulo')}</h2>
        <p className="text-sm text-muted">{t('descricao')}</p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-4"
        aria-label={t('titulo')}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { role, validity, maxUses },
            {
              onSuccess: (invite) => {
                setCreated(invite);
                success(t('gerado'), t('geradoDescricao'));
              },
              onError: (e) => error(t('erroGerar'), errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Select label={t('papel')} options={roleOptions} value={role} onChange={(e) => setRole(e.target.value as StaffRole)} />
          <Select
            label={t('validade')}
            options={VALIDITIES.map((v) => ({ value: v, label: t(`validades.${v}`) }))}
            value={validity}
            onChange={(e) => setValidity(e.target.value as CreateStaffInviteInput['validity'])}
          />
          <Select label={t('usos')} options={USES.map((n) => ({ value: String(n), label: t('usosOpcao', { count: n }) }))} value={String(maxUses)} onChange={(e) => setMaxUses(Number(e.target.value))} />
        </div>
        <div>
          <Button type="submit" variant="secondary" loading={create.isPending} iconLeft={<Link2 className="size-4" aria-hidden />}>
            {t('gerar')}
          </Button>
        </div>
      </form>

      {created?.link && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3" role="status">
          <Input label={t('seuLink')} hint={t('seuLinkDica')} readOnly value={created.link} onFocus={(e) => e.target.select()} inputClassName="font-mono text-xs" />
          <div>
            <Button size="sm" iconLeft={<ClipboardCopy className="size-4" aria-hidden />} onClick={() => void copy(created.link ?? '')}>
              {t('copiar')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-base">{t('ativos')}</h3>
        {invites.isPending ? (
          <div role="status" aria-label={t('carregando')}>
            <Skeleton className="h-12 w-full" />
          </div>
        ) : invites.isError ? (
          <ErrorState description={errorMessage(invites.error)} onRetry={() => void invites.refetch()} />
        ) : active.length === 0 ? (
          <p className="text-sm text-muted">{t('nenhumAtivo')}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('ativos')}>
            {active.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3" data-testid="staff-invite">
                <span className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-semibold text-text">{t('papelUsos', { papel: invite.role, usados: invite.uses, total: invite.maxUses })}</span>
                  <span className="text-xs text-muted">{t('valeAte', { data: formatDateTime(invite.expiresAt) })}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={revoke.isPending && revoke.variables === invite.id}
                  iconLeft={<Link2Off className="size-4" aria-hidden />}
                  aria-label={t('revogarRotulo', { papel: invite.role, data: formatDateTime(invite.expiresAt) })}
                  onClick={() =>
                    revoke.mutate(invite.id, {
                      onSuccess: () => {
                        if (created?.id === invite.id) setCreated(null);
                        success(t('revogado'), t('revogadoDescricao'));
                      },
                      onError: (e) => error(t('erroRevogar'), errorMessage(e)),
                    })
                  }
                >
                  {t('revogar')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
