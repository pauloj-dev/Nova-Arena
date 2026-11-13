'use client';

import type { OrganizerTournamentDetail, Registration } from '@nova/schemas';
import { Button, Modal, Select, Textarea, useToast } from '@nova/ui';
import { useId, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useWithdraw } from '@/shared/api/hooks/competition';
import { FORMAT_INFO } from '../lib/formats';
import { withdrawEffect } from './stageUtils';

type Kind = 'DISQUALIFIED' | 'WITHDRAWN';
const KIND_LABEL: Record<Kind, string> = { DISQUALIFIED: 'Desclassificação (decisão da organização)', WITHDRAWN: 'Desistência (pedido do participante)' };

/**
 * Desistência ou desclassificação com o campeonato em andamento (RN-06): motivo obrigatório e,
 * antes de confirmar, a explicação do que acontece na fase atual conforme o formato dela.
 */
export function WithdrawDialog({ tournament: t, registration, onClose }: { tournament: OrganizerTournamentDetail; registration: Registration; onClose: () => void }) {
  const formId = useId();
  const withdraw = useWithdraw(t.id);
  const { success, error } = useToast();
  const [kind, setKind] = useState<Kind>('DISQUALIFIED');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const active = t.stages.find((s) => s.status === 'ACTIVE');
  const invalid = reason.trim().length < 3;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Tirar ${registration.displayName} do campeonato`}
      description="Com a fase em andamento a vaga não é reposta: não há substituição (RN-06)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" type="submit" form={formId} loading={withdraw.isPending}>
            {kind === 'DISQUALIFIED' ? 'Desclassificar' : 'Registrar desistência'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (invalid) return;
          withdraw.mutate(
            { registrationId: registration.id, kind, reason: reason.trim() },
            {
              onSuccess: () => {
                success(kind === 'DISQUALIFIED' ? `${registration.displayName} foi desclassificado` : `Desistência de ${registration.displayName} registrada`, 'A chave e a tabela já foram atualizadas.');
                onClose();
              },
              onError: (e) => error('Não foi possível concluir', errorMessage(e)),
            },
          );
        }}
      >
        <Select label="O que aconteceu" value={kind} onChange={(e) => setKind(e.target.value as Kind)} options={(Object.keys(KIND_LABEL) as Kind[]).map((value) => ({ value, label: KIND_LABEL[value] }))} />
        <div className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text" data-testid="withdraw-effect">
          <p className="font-semibold">{active ? `O que acontece em "${active.name}" (${FORMAT_INFO[active.format].name}):` : 'O que acontece:'}</p>
          <p>{withdrawEffect(active, kind)}</p>
        </div>
        <Textarea label="Motivo" required rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Fica na auditoria. Na desclassificação, o participante vê este texto." error={attempted && invalid ? 'Informe o motivo (pelo menos 3 letras)' : undefined} />
      </form>
    </Modal>
  );
}
