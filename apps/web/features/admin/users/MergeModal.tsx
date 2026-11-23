'use client';

import type { AdminUser } from '@nova/schemas';
import { ConfirmDestructive, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useMergeUsers } from '@/shared/api/hooks/admin';
import { useT } from '@/shared/i18n/react';
import { UserPicker } from '../common/UserPicker';
import { adminUsersMessages } from './messages';

interface MergeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A conta que fica (destino). */
  target: Pick<AdminUser, 'id' | 'nickname'>;
}

/**
 * Mesclar conta duplicada (RN-13). A conta aberta é a que fica; a escolhida aqui é a duplicada.
 * Irreversível: pede o apelido da conta que fica, digitado, e o motivo.
 */
export function MergeModal({ open, onOpenChange, target }: MergeModalProps) {
  const t = useT(adminUsersMessages, 'MergeModal');
  const toast = useToast();
  const merge = useMergeUsers();
  const [source, setSource] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSource(null);
    setReason('');
    setError(null);
    onOpenChange(false);
  }

  function confirm() {
    if (!source) {
      setError(t('escolhaDuplicada'));
      return;
    }
    if (reason.trim().length < 5) {
      setError(t('informeMotivo'));
      return;
    }
    setError(null);
    merge.mutate(
      { targetId: target.id, sourceUserId: source.id, reason: reason.trim() },
      {
        onSuccess: (result) => {
          toast.success(
            t('mescladas'),
            t('mescladasDetalhe', {
              origem: source.nickname,
              destino: target.nickname,
              inscricoes: String(result.moved.registrations),
              squads: String(result.moved.teams),
              ids: String(result.moved.gameAccounts),
            }),
          );
          close();
        },
        onError: (e) => setError(e instanceof ApiError && e.code === 'MERGE_CONFLICT' ? e.message : errorMessage(e)),
      },
    );
  }

  const description = t.rich('descricao', { apelido: target.nickname, strong: (chunks) => <strong>{chunks}</strong> });

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={(next) => {
        if (!next && !merge.isPending) close();
      }}
      title={t('titulo')}
      description={<>{description}</>}
      confirmText={target.nickname}
      confirmLabel={t('confirmar')}
      loading={merge.isPending}
      onConfirm={confirm}
    >
      <UserPicker label={t('contaDuplicada')} value={source} onChange={setSource} excludeIds={[target.id]} />
      <Textarea label={t('motivo')} required rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} hint={t('motivoDica')} />
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
          {error}
        </p>
      )}
    </ConfirmDestructive>
  );
}
