'use client';

import type { AdminUserDetail, Sanction } from '@nova/schemas';
import { REPORT_REASON_LABELS } from '@nova/schemas';
import { Badge, Button, Card, cn, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { ArrowLeft, Ban, Copy, ExternalLink, Flag, Gamepad2, KeyRound, Merge, MessageSquareWarning, PauseCircle, ShieldCheck, ShieldOff, Target, Undo2, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAdminUser, useGrantRole, useLiftSanction, useResetUserPassword, useResetUserTwoFactor } from '@/shared/api/hooks/admin';
import { useAuditLogs } from '@/shared/api/hooks/admin-audit';
import { useAdminReports } from '@/shared/api/hooks/admin-moderation';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDate, formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { AuditTimeline } from '../audit/AuditTimeline';
import { ReasonModal } from '../common/ReasonModal';
import { RoleBadges, UserIdentity, UserStatusPill } from '../common/UserBits';
import { MergeModal } from './MergeModal';
import { adminUsersMessages } from './messages';
import { SanctionModal, type SanctionType } from './SanctionModal';

function sanctionState(s: Sanction): { text: string; tone: 'neutral' | 'warning' | 'danger' } {
  const t = getT(adminUsersMessages, 'UserDetailPage');
  if (s.liftedAt) return { text: t('removidaEm', { data: formatDate(s.liftedAt) }), tone: 'neutral' };
  if (s.type === 'WARNING') return { text: t('registrada'), tone: 'neutral' };
  if (s.endsAt && new Date(s.endsAt).getTime() <= Date.now()) return { text: t('terminouEm', { data: formatDate(s.endsAt) }), tone: 'neutral' };
  return s.type === 'BAN' ? { text: t('emVigor'), tone: 'danger' } : { text: t('emVigorAte', { data: formatDate(s.endsAt ?? '') }), tone: 'warning' };
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
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
  const t = useT(adminUsersMessages, 'UserDetailPage');
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
      <ArrowLeft className="size-4" aria-hidden /> {t('voltarUsuarios')}
    </Link>
  );

  if (detail.isPending) {
    return (
      <PageContainer>
        {back}
        <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
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
        <h1 className="sr-only">{t('perfilDoUsuario')}</h1>
        {missing ? (
          <EmptyState title={t('naoEncontrado')} description={t('naoEncontradoDescricao')} action={<Button asChild>{<Link href="/admin/usuarios">{t('verTodos')}</Link>}</Button>} />
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
  const blocked = isSelf ? t('bloqueioPropria') : targetIsSuper ? t('bloqueioSuper') : targetIsAdmin && !iAmSuper ? t('bloqueioAdmin') : gone ? t('bloqueioInexistente') : null;
  const target = { id: u.id, nickname: u.nickname };
  const organizerLimits = u.organizerLimits
    ? t.rich('limitesOrganizador', {
        verificado: u.verifiedOrganizer ? 'sim' : 'nao',
        max: u.organizerLimits.maxActiveTournaments,
        jogos: u.organizerLimits.allowedGameIds.length,
        link: (chunks) => (
          <Link href="/admin/organizadores" className="font-semibold text-primary-text hover:underline">
            {chunks}
          </Link>
        ),
      })
    : null;

  function generateResetLink() {
    resetPassword.mutate(u.id, {
      onSuccess: ({ link }) => {
        setResetLink(link);
        toast.success(t('linkGerado'), t('linkGeradoDetalhe'));
      },
      onError: (error) => toast.error(t('linkFalhou'), errorMessage(error)),
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('linkCopiado'));
    } catch {
      toast.error(t('copiaFalhou'), t('copiaFalhouDetalhe'));
    }
  }

  return (
    <PageContainer>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="sr-only">{t('perfilDe', { apelido: u.nickname })}</h1>
          <UserIdentity user={u} size="lg" />
          <div className="flex flex-wrap items-center gap-2">
            <UserStatusPill status={u.status} />
            {u.suspendedUntil && <span className="text-sm text-muted">{t('ate', { data: formatDateTime(u.suspendedUntil) })}</span>}
            <RoleBadges roles={u.roles} />
          </div>
        </div>
        {!gone && (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/u/${encodeURIComponent(u.nickname)}`}>
              <ExternalLink className="size-4" aria-hidden /> {t('perfilPublico')}
            </Link>
          </Button>
        )}
      </div>

      <Section id="acoes" title={t('acoes')} icon={<ShieldCheck className="size-5" />}>
        {blocked && (
          <p role="note" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
            {blocked}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={Boolean(blocked) || u.status === 'BANNED'} onClick={() => setDialog({ kind: 'sanction', type: 'WARNING' })} iconLeft={<MessageSquareWarning className="size-4" aria-hidden />}>
            {t('advertir')}
          </Button>
          <Button variant="secondary" disabled={Boolean(blocked) || u.status === 'BANNED'} onClick={() => setDialog({ kind: 'sanction', type: 'SUSPENSION' })} iconLeft={<PauseCircle className="size-4" aria-hidden />}>
            {t('suspender')}
          </Button>
          <Button variant="danger" disabled={Boolean(blocked) || u.status === 'BANNED'} onClick={() => setDialog({ kind: 'sanction', type: 'BAN' })} iconLeft={<Ban className="size-4" aria-hidden />}>
            {t('banir')}
          </Button>
          <Button variant="secondary" disabled={Boolean(blocked)} loading={resetPassword.isPending} onClick={generateResetLink} iconLeft={<KeyRound className="size-4" aria-hidden />}>
            {t('redefinirSenha')}
          </Button>
          <Button variant="secondary" disabled={gone} onClick={() => setDialog({ kind: 'merge' })} iconLeft={<Merge className="size-4" aria-hidden />}>
            {t('mesclar')}
          </Button>
          {iAmSuper && u.twoFactorEnabled && !isSelf && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'reset-2fa' })} iconLeft={<ShieldOff className="size-4" aria-hidden />}>
              {t('redefinir2fa')}
            </Button>
          )}
          {u.status === 'ACTIVE' && !u.roles.includes('ORGANIZER') && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'grant', role: 'ORGANIZER' })} iconLeft={<Target className="size-4" aria-hidden />}>
              {t('tornarOrganizador')}
            </Button>
          )}
        </div>
        {resetLink && (
          <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-2 p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="info">{t('prototipo')}</Badge>
              {t('prototipoAviso')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 rounded-sm bg-surface px-2 py-1 font-mono text-xs [overflow-wrap:anywhere]">{resetLink}</code>
              <Button size="sm" variant="secondary" onClick={() => void copy(resetLink)} iconLeft={<Copy className="size-4" aria-hidden />}>
                {t('copiarLink')}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section id="dados" title={t('dados')} icon={<Users className="size-5" />}>
          <dl className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label={t('email')}>
              {u.email} {u.emailVerified ? <Badge tone="primary">{t('confirmado')}</Badge> : <Badge tone="warning">{t('naoConfirmado')}</Badge>}
            </Field>
            <Field label={t('doisFatores')}>{u.twoFactorEnabled ? t('ativa') : t('inativa')}</Field>
            <Field label={t('estado')}>{u.state ?? '—'}</Field>
            <Field label={t('criadaEm')}>{formatDate(u.createdAt)}</Field>
            <Field label={t('ultimoAcesso')}>{formatRelative(u.lastSeenAt)}</Field>
            <Field label={t('idConta')}>
              <code className="font-mono text-xs">{u.id}</code>
            </Field>
            <Field label={t('bio')} className="xs:col-span-2">
              {u.bio ?? '—'}
            </Field>
          </dl>
          {u.organizerLimits && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">
              {organizerLimits}
            </p>
          )}
        </Section>

        <Section id="historico" title={t('historico')} icon={<Flag className="size-5" />}>
          <dl className="grid grid-cols-2 gap-3">
            <Field label={t('jogados')}>
              <span className="tabular text-lg font-bold">{u.tournamentsPlayed}</span>
            </Field>
            <Field label={t('organizados')}>
              <span className="tabular text-lg font-bold">{u.tournamentsOrganized}</span>
            </Field>
          </dl>
          <h3 className="text-sm font-semibold">{t('jaFez')}</h3>
          {history.isError ? (
            <ErrorState description={errorMessage(history.error)} onRetry={() => void history.refetch()} />
          ) : (
            <AuditTimeline compact loading={history.isPending} logs={history.data?.items.slice(0, 5)} label={t('acoesSobre', { apelido: u.nickname })} empty={<p className="text-sm text-muted">{t('nenhumaAcao')}</p>} />
          )}
          {(history.data?.total ?? 0) > 5 && (
            <Link href="/admin/auditoria" className="text-sm font-semibold text-primary-text hover:underline">
              {t('verAuditoria')}
            </Link>
          )}
        </Section>

        <Section id="ids" title={t('idsJogo')} icon={<Gamepad2 className="size-5" />}>
          {u.gameAccounts.length === 0 ? (
            <p className="text-sm text-muted">{t('nenhumId')}</p>
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

        <Section id="squads" title={t('squads')} icon={<Users className="size-5" />}>
          {u.teams.length === 0 ? (
            <p className="text-sm text-muted">{t('nenhumSquad')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {u.teams.map((team) => (
                <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-semibold">
                    {team.name} <span className="font-normal text-muted">[{team.tag}]</span>
                  </span>
                  {team.isCaptain ? <Badge tone="gold">{t('capitao')}</Badge> : <span className="text-muted">{t('membro')}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="sancoes" title={t('sancoes')} icon={<Ban className="size-5" />}>
          {u.sanctions.length === 0 ? (
            <p className="text-sm text-muted">{t('nenhumaSancao')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {u.sanctions.map((s) => {
                const state = sanctionState(s);
                const inForce = state.tone !== 'neutral' || (s.type === 'WARNING' && !s.liftedAt);
                return (
                  <li key={s.id} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm" data-testid="sanction">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t(`sancao.${s.type}`)}</span>
                      <Badge tone={state.tone}>{state.text}</Badge>
                    </span>
                    <span className="[overflow-wrap:anywhere]">{s.reason}</span>
                    <span className="text-xs text-muted">{t('porEm', { apelido: s.issuedByNickname, data: formatDateTime(s.startsAt) })}</span>
                    {inForce && !blocked && (
                      <Button size="sm" variant="secondary" className="self-start" onClick={() => setDialog({ kind: 'lift', sanction: s })} iconLeft={<Undo2 className="size-4" aria-hidden />}>
                        {t('removerSancao')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section id="denuncias" title={t('denuncias')} icon={<Flag className="size-5" />} aside={<span className="tabular text-sm text-muted">{t('noTotal', { n: String(u.reportsAgainst) })}</span>}>
          {reports.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : reports.isError ? (
            <ErrorState description={errorMessage(reports.error)} onRetry={() => void reports.refetch()} />
          ) : reports.data.items.length === 0 ? (
            <p className="text-sm text-muted">{t('nenhumaDenuncia')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reports.data.items.slice(0, 5).map((r) => (
                <li key={r.id} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{REPORT_REASON_LABELS[r.reason]}</span>
                    {r.status === 'OPEN' || r.status === 'IN_REVIEW' ? <StatusPill status={r.status} /> : <Badge tone="neutral">{r.status === 'ACTIONED' ? t('tratada') : t('improcedente')}</Badge>}
                  </span>
                  <span className="text-muted [overflow-wrap:anywhere]">{r.description}</span>
                  <span className="text-xs text-muted">{t('porQuando', { apelido: r.reporterNickname, quando: formatRelative(r.createdAt) })}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/moderacao" className="text-sm font-semibold text-primary-text hover:underline">
            {t('abrirModeracao')}
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
        title={t('removerSancao')}
        description={dialog?.kind === 'lift' && dialog.sanction.type !== 'WARNING' ? t('liftContaAtiva', { apelido: u.nickname }) : t('liftAdvertencia', { apelido: u.nickname })}
        minLength={0}
        confirmLabel={t('removerSancao')}
        loading={lift.isPending}
        onConfirm={(reason) => {
          if (dialog?.kind !== 'lift') return;
          lift.mutate(
            { sanctionId: dialog.sanction.id, reason: reason || undefined },
            {
              onSuccess: () => {
                toast.success(t('sancaoRemovida'));
                setDialog(null);
              },
              onError: (error) => toast.error(t('removerFalhou'), errorMessage(error)),
            },
          );
        }}
      />
      <ReasonModal
        open={dialog?.kind === 'reset-2fa'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={t('redefinir2faTitulo', { apelido: u.nickname })}
        description={t('redefinir2faDescricao')}
        confirmLabel={t('redefinir2fa')}
        variant="danger"
        loading={resetTwoFactor.isPending}
        onConfirm={(reason) =>
          resetTwoFactor.mutate(
            { userId: u.id, reason },
            {
              onSuccess: () => {
                toast.success(t('redefinido2fa'));
                setDialog(null);
              },
              onError: (error) => toast.error(t('redefinirFalhou'), errorMessage(error)),
            },
          )
        }
      />
      <ReasonModal
        open={dialog?.kind === 'grant'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={t('tornarTitulo', { apelido: u.nickname })}
        description={t('tornarDescricao')}
        minLength={0}
        confirmLabel={t('tornarOrganizador')}
        loading={grant.isPending}
        onConfirm={(reason) =>
          grant.mutate(
            { userId: u.id, role: 'ORGANIZER', reason },
            {
              onSuccess: () => {
                toast.success(t('agoraOrganizador', { apelido: u.nickname }));
                setDialog(null);
              },
              onError: (error) => toast.error(t('concederFalhou'), errorMessage(error)),
            },
          )
        }
      />
    </PageContainer>
  );
}
