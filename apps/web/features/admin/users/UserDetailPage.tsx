'use client';

import type { AdminUserDetail, Sanction } from '@nova/schemas';
import { REPORT_REASON_LABELS } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { ArrowLeft, Ban, Copy, ExternalLink, Flag, Gamepad2, KeyRound, Merge, MessageSquareWarning, PauseCircle, ShieldCheck, ShieldOff, Target, Undo2, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAdminUser, useGrantRole, useLiftSanction, useResetUserPassword, useResetUserTwoFactor } from '@/shared/api/hooks/admin';
import { useAuditLogs } from '@/shared/api/hooks/admin-audit';
import { useAdminReports } from '@/shared/api/hooks/admin-moderation';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDate, formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { AuditTimeline } from '../audit/AuditTimeline';
import { plural } from '../common/format';
import { ReasonModal } from '../common/ReasonModal';
import { RoleBadges, UserIdentity, UserStatusPill } from '../common/UserBits';
import { MergeModal } from './MergeModal';
import { SanctionModal, type SanctionType } from './SanctionModal';

const SANCTION_LABEL: Record<Sanction['type'], string> = { WARNING: 'Advertência', SUSPENSION: 'Suspensão', BAN: 'Banimento' };

function sanctionState(s: Sanction): { text: string; tone: 'neutral' | 'warning' | 'danger' } {
  if (s.liftedAt) return { text: `Removida em ${formatDate(s.liftedAt)}`, tone: 'neutral' };
  if (s.type === 'WARNING') return { text: 'Registrada', tone: 'neutral' };
  if (s.endsAt && new Date(s.endsAt).getTime() <= Date.now()) return { text: `Terminou em ${formatDate(s.endsAt)}`, tone: 'neutral' };
  return s.type === 'BAN' ? { text: 'Em vigor', tone: 'danger' } : { text: `Em vigor até ${formatDate(s.endsAt ?? '')}`, tone: 'warning' };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Section({ id, title, icon, children, aside }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Card>
      <section aria-labelledby={id} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={id} className="flex items-center gap-2 text-lg">
            <span className="text-muted" aria-hidden>
              {icon}
            </span>
            {title}
          </h2>
          {aside}
        </div>
        {children}
      </section>
    </Card>
  );
}

type Dialog = { kind: 'sanction'; type: SanctionType } | { kind: 'merge' } | { kind: 'lift'; sanction: Sanction } | { kind: 'reset-2fa' } | { kind: 'grant'; role: 'ADMIN' | 'ORGANIZER' } | null;

/** Perfil completo de um usuário para o Admin (ADM-04): dados, IDs de jogo, squads, histórico, sanções e denúncias. */
export function UserDetailPage({ userId }: { userId: string }) {
  const toast = useToast();
  const { user: me } = useSession();
  const detail = useAdminUser(userId);
  const history = useAuditLogs({ entityId: userId, page: 1 });
  const reports = useAdminReports({ targetUserId: userId, page: 1 });
  const lift = useLiftSanction();
  const resetPassword = useResetUserPassword();
  const resetTwoFactor = useResetUserTwoFactor();
  const grant = useGrantRole();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const back = (
    <Link href="/admin/usuarios" className="inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-semibold text-muted hover:text-text md:min-h-0">
      <ArrowLeft className="size-4" aria-hidden /> Usuários
    </Link>
  );

  if (detail.isPending) {
    return (
      <PageContainer>
        {back}
        <div className="flex flex-col gap-4" role="status" aria-label="Carregando perfil">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <PageContainer>
        {back}
        <h1 className="sr-only">Perfil do usuário</h1>
        {missing ? (
          <EmptyState title="Usuário não encontrado" description="Esta conta não existe. Confira o endereço ou volte para a lista." action={<Button asChild>{<Link href="/admin/usuarios">Ver todos os usuários</Link>}</Button>} />
        ) : (
          <ErrorState description={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        )}
      </PageContainer>
    );
  }

  const u: AdminUserDetail = detail.data;
  const iAmSuper = Boolean(me?.roles.includes('SUPER_ADMIN'));
  const isSelf = me?.id === u.id;
  const targetIsSuper = u.roles.includes('SUPER_ADMIN');
  const targetIsAdmin = u.roles.includes('ADMIN') || targetIsSuper;
  const gone = u.status === 'MERGED' || u.status === 'DELETED';
  // As mesmas regras da API (que é quem decide): ninguém age sobre o Super Admin nem sobre si; sobre Admin, só o Super Admin.
  const blocked = isSelf ? 'Você não pode aplicar estas ações na própria conta.' : targetIsSuper ? 'Ninguém aplica sanção nem redefine a senha do Super Admin.' : targetIsAdmin && !iAmSuper ? 'Só o Super Admin age sobre a conta de outro administrador.' : gone ? 'Esta conta não existe mais.' : null;
  const target = { id: u.id, nickname: u.nickname };

  function generateResetLink() {
    resetPassword.mutate(u.id, {
      onSuccess: ({ link }) => {
        setResetLink(link);
        toast.success('Link de redefinição gerado', 'O usuário foi avisado.');
      },
      onError: (error) => toast.error('Não foi possível gerar o link', errorMessage(error)),
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar', 'Selecione o link e copie manualmente.');
    }
  }

  return (
    <PageContainer>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="sr-only">Perfil de {u.nickname}</h1>
          <UserIdentity user={u} size="lg" />
          <div className="flex flex-wrap items-center gap-2">
            <UserStatusPill status={u.status} />
            {u.suspendedUntil && <span className="text-sm text-muted">até {formatDateTime(u.suspendedUntil)}</span>}
            <RoleBadges roles={u.roles} />
          </div>
        </div>
        {!gone && (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/u/${encodeURIComponent(u.nickname)}`}>
              <ExternalLink className="size-4" aria-hidden /> Perfil público
            </Link>
          </Button>
        )}
      </div>

      <Section id="acoes" title="Ações" icon={<ShieldCheck className="size-5" />}>
        {blocked && (
          <p role="note" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
            {blocked}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={Boolean(blocked) || u.status === 'BANNED'} onClick={() => setDialog({ kind: 'sanction', type: 'WARNING' })} iconLeft={<MessageSquareWarning className="size-4" aria-hidden />}>
            Advertir
          </Button>
          <Button variant="secondary" disabled={Boolean(blocked) || u.status === 'BANNED'} onClick={() => setDialog({ kind: 'sanction', type: 'SUSPENSION' })} iconLeft={<PauseCircle className="size-4" aria-hidden />}>
            Suspender
          </Button>
          <Button variant="danger" disabled={Boolean(blocked) || u.status === 'BANNED'} onClick={() => setDialog({ kind: 'sanction', type: 'BAN' })} iconLeft={<Ban className="size-4" aria-hidden />}>
            Banir
          </Button>
          <Button variant="secondary" disabled={Boolean(blocked)} loading={resetPassword.isPending} onClick={generateResetLink} iconLeft={<KeyRound className="size-4" aria-hidden />}>
            Redefinir senha
          </Button>
          <Button variant="secondary" disabled={gone} onClick={() => setDialog({ kind: 'merge' })} iconLeft={<Merge className="size-4" aria-hidden />}>
            Mesclar conta duplicada
          </Button>
          {iAmSuper && u.twoFactorEnabled && !isSelf && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'reset-2fa' })} iconLeft={<ShieldOff className="size-4" aria-hidden />}>
              Redefinir 2FA
            </Button>
          )}
          {u.status === 'ACTIVE' && !u.roles.includes('ORGANIZER') && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'grant', role: 'ORGANIZER' })} iconLeft={<Target className="size-4" aria-hidden />}>
              Tornar organizador
            </Button>
          )}
        </div>
        {resetLink && (
          <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-2 p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="info">Protótipo</Badge>
              Na versão final este link vai por e-mail para o usuário e não aparece para o Admin.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 rounded-sm bg-surface px-2 py-1 font-mono text-xs [overflow-wrap:anywhere]">{resetLink}</code>
              <Button size="sm" variant="secondary" onClick={() => void copy(resetLink)} iconLeft={<Copy className="size-4" aria-hidden />}>
                Copiar link
              </Button>
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section id="dados" title="Dados da conta" icon={<Users className="size-5" />}>
          <dl className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="E-mail">
              {u.email} {u.emailVerified ? <Badge tone="primary">Confirmado</Badge> : <Badge tone="warning">Não confirmado</Badge>}
            </Field>
            <Field label="Verificação em duas etapas">{u.twoFactorEnabled ? 'Ativa' : 'Inativa'}</Field>
            <Field label="Estado">{u.state ?? '—'}</Field>
            <Field label="Conta criada em">{formatDate(u.createdAt)}</Field>
            <Field label="Último acesso">{formatRelative(u.lastSeenAt)}</Field>
            <Field label="ID da conta">
              <code className="font-mono text-xs">{u.id}</code>
            </Field>
            <div className="xs:col-span-2">
              <Field label="Bio">{u.bio ?? '—'}</Field>
            </div>
          </dl>
          {u.organizerLimits && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">
              Organizador{u.verifiedOrganizer ? ' verificado' : ''}: até {plural(u.organizerLimits.maxActiveTournaments, 'campeonato simultâneo', 'campeonatos simultâneos')} ·{' '}
              {u.organizerLimits.allowedGameIds.length === 0 ? 'todos os jogos' : plural(u.organizerLimits.allowedGameIds.length, 'jogo permitido', 'jogos permitidos')}.{' '}
              <Link href="/admin/organizadores" className="font-semibold text-primary-text hover:underline">
                Ajustar limites
              </Link>
            </p>
          )}
        </Section>

        <Section id="historico" title="Histórico" icon={<Flag className="size-5" />}>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Campeonatos jogados">
              <span className="tabular text-lg font-bold">{u.tournamentsPlayed}</span>
            </Field>
            <Field label="Campeonatos organizados">
              <span className="tabular text-lg font-bold">{u.tournamentsOrganized}</span>
            </Field>
          </dl>
          <h3 className="text-sm font-semibold">O que a administração já fez nesta conta</h3>
          {history.isError ? (
            <ErrorState description={errorMessage(history.error)} onRetry={() => void history.refetch()} />
          ) : (
            <AuditTimeline compact loading={history.isPending} logs={history.data?.items.slice(0, 5)} label={`Ações da administração sobre ${u.nickname}`} empty={<p className="text-sm text-muted">Nenhuma ação registrada sobre esta conta.</p>} />
          )}
          {(history.data?.total ?? 0) > 5 && (
            <Link href="/admin/auditoria" className="text-sm font-semibold text-primary-text hover:underline">
              Ver tudo na auditoria
            </Link>
          )}
        </Section>

        <Section id="ids" title="IDs de jogo" icon={<Gamepad2 className="size-5" />}>
          {u.gameAccounts.length === 0 ? (
            <p className="text-sm text-muted">Nenhum ID de jogo cadastrado.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {u.gameAccounts.map((account) => (
                <li key={account.gameName} className="rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-semibold">{account.gameName}</span>
                  <span className="block text-muted [overflow-wrap:anywhere]">
                    {Object.entries(account.fields)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="squads" title="Squads" icon={<Users className="size-5" />}>
          {u.teams.length === 0 ? (
            <p className="text-sm text-muted">Não participa de nenhum squad.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {u.teams.map((team) => (
                <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-semibold">
                    {team.name} <span className="font-normal text-muted">[{team.tag}]</span>
                  </span>
                  {team.isCaptain ? <Badge tone="gold">Capitão</Badge> : <span className="text-muted">Membro</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="sancoes" title="Sanções" icon={<Ban className="size-5" />}>
          {u.sanctions.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma sanção nesta conta.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {u.sanctions.map((s) => {
                const state = sanctionState(s);
                const inForce = state.tone !== 'neutral' || (s.type === 'WARNING' && !s.liftedAt);
                return (
                  <li key={s.id} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm" data-testid="sanction">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{SANCTION_LABEL[s.type]}</span>
                      <Badge tone={state.tone}>{state.text}</Badge>
                    </span>
                    <span className="[overflow-wrap:anywhere]">{s.reason}</span>
                    <span className="text-xs text-muted">
                      Por {s.issuedByNickname} em {formatDateTime(s.startsAt)}
                    </span>
                    {inForce && !blocked && (
                      <Button size="sm" variant="secondary" className="self-start" onClick={() => setDialog({ kind: 'lift', sanction: s })} iconLeft={<Undo2 className="size-4" aria-hidden />}>
                        Remover sanção
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          id="denuncias"
          title="Denúncias recebidas"
          icon={<Flag className="size-5" />}
          aside={
            <span className="tabular text-sm text-muted">
              {u.reportsAgainst} no total
            </span>
          }
        >
          {reports.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : reports.isError ? (
            <ErrorState description={errorMessage(reports.error)} onRetry={() => void reports.refetch()} />
          ) : reports.data.items.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma denúncia contra esta conta.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reports.data.items.slice(0, 5).map((r) => (
                <li key={r.id} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{REPORT_REASON_LABELS[r.reason]}</span>
                    {r.status === 'OPEN' || r.status === 'IN_REVIEW' ? <StatusPill status={r.status} /> : <Badge tone="neutral">{r.status === 'ACTIONED' ? 'Tratada' : 'Improcedente'}</Badge>}
                  </span>
                  <span className="text-muted [overflow-wrap:anywhere]">{r.description}</span>
                  <span className="text-xs text-muted">
                    Por {r.reporterNickname} · {formatRelative(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/moderacao" className="text-sm font-semibold text-primary-text hover:underline">
            Abrir a moderação
          </Link>
        </Section>
      </div>

      {dialog?.kind === 'sanction' && (
        <SanctionModal
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          type={dialog.type}
          targets={[target]}
        />
      )}
      <MergeModal
        open={dialog?.kind === 'merge'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        target={target}
      />
      <ReasonModal
        open={dialog?.kind === 'lift'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Remover sanção"
        description={dialog?.kind === 'lift' && dialog.sanction.type !== 'WARNING' ? `A conta de ${u.nickname} volta a ficar ativa na hora.` : `A advertência deixa de contar no histórico de ${u.nickname}.`}
        minLength={0}
        confirmLabel="Remover sanção"
        loading={lift.isPending}
        onConfirm={(reason) => {
          if (dialog?.kind !== 'lift') return;
          lift.mutate(
            { sanctionId: dialog.sanction.id, reason: reason || undefined },
            {
              onSuccess: () => {
                toast.success('Sanção removida');
                setDialog(null);
              },
              onError: (error) => toast.error('Não foi possível remover a sanção', errorMessage(error)),
            },
          );
        }}
      />
      <ReasonModal
        open={dialog?.kind === 'reset-2fa'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={`Redefinir o 2FA de ${u.nickname}`}
        description="Para quem perdeu o autenticador e os códigos de recuperação. A verificação é desligada e a pessoa configura de novo. Se for administrador, fica sem acesso ao painel até lá."
        confirmLabel="Redefinir 2FA"
        variant="danger"
        loading={resetTwoFactor.isPending}
        onConfirm={(reason) =>
          resetTwoFactor.mutate(
            { userId: u.id, reason },
            {
              onSuccess: () => {
                toast.success('Verificação em duas etapas redefinida');
                setDialog(null);
              },
              onError: (error) => toast.error('Não foi possível redefinir', errorMessage(error)),
            },
          )
        }
      />
      <ReasonModal
        open={dialog?.kind === 'grant'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={`Tornar ${u.nickname} organizador`}
        description="A conta ganha a área de organização, com o limite padrão de 3 campeonatos simultâneos e todos os jogos."
        minLength={0}
        confirmLabel="Tornar organizador"
        loading={grant.isPending}
        onConfirm={(reason) =>
          grant.mutate(
            { userId: u.id, role: 'ORGANIZER', reason },
            {
              onSuccess: () => {
                toast.success(`${u.nickname} agora é organizador`);
                setDialog(null);
              },
              onError: (error) => toast.error('Não foi possível conceder o papel', errorMessage(error)),
            },
          )
        }
      />
    </PageContainer>
  );
}
