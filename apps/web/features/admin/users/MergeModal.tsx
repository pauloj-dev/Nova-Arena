'use client';

import type { AdminUser } from '@nova/schemas';
import { ConfirmDestructive, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useMergeUsers } from '@/shared/api/hooks/admin';
import { UserPicker } from '../common/UserPicker';

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
      setError('Escolha a conta duplicada.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Informe o motivo (pelo menos 5 caracteres).');
      return;
    }
    setError(null);
    merge.mutate(
      { targetId: target.id, sourceUserId: source.id, reason: reason.trim() },
      {
        onSuccess: (result) => {
          toast.success('Contas mescladas', `${source.nickname} foi mesclada em ${target.nickname}: ${result.moved.registrations} inscrição(ões), ${result.moved.teams} squad(s) e ${result.moved.gameAccounts} ID(s) de jogo transferidos.`);
          close();
        },
        onError: (e) => setError(e instanceof ApiError && e.code === 'MERGE_CONFLICT' ? e.message : errorMessage(e)),
      },
    );
  }

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={(next) => {
        if (!next && !merge.isPending) close();
      }}
      title="Mesclar conta duplicada"
      description={
        <>
          A conta <strong>{target.nickname}</strong> fica. A conta duplicada perde o acesso para sempre; inscrições, squads (com capitania) e IDs de jogo dela passam para {target.nickname}. Papéis não são transferidos.{' '}
          <strong>Não dá para desfazer.</strong>
        </>
      }
      confirmText={target.nickname}
      confirmLabel="Mesclar contas"
      loading={merge.isPending}
      onConfirm={confirm}
    >
      <UserPicker label="Conta duplicada (a que deixa de existir)" value={source} onChange={setSource} excludeIds={[target.id]} />
      <Textarea label="Motivo" required rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} hint="Fica registrado na auditoria." />
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
          {error}
        </p>
      )}
    </ConfirmDestructive>
  );
}
