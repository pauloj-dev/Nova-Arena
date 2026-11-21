'use client';

import type { OrganizerTournamentDetail, Registration } from '@nova/schemas';
import { Button, Modal, Select, Textarea, useToast } from '@nova/ui';
import { useId, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useWithdraw } from '@/shared/api/hooks/competition';
import { useT } from '@/shared/i18n/react';
import { FORMAT_INFO } from '../lib/formats';
import { messages } from './messages';
import { withdrawEffect } from './stageUtils';

type Kind = 'DISQUALIFIED' | 'WITHDRAWN';
const KIND_LABEL = { DISQUALIFIED: 'desclassificacao', WITHDRAWN: 'desistencia' } as const satisfies Record<Kind, string>;

/**
 * Desistência ou desclassificação com o campeonato em andamento (RN-06): motivo obrigatório e,
 * antes de confirmar, a explicação do que acontece na fase atual conforme o formato dela.
 */
export function WithdrawDialog({ tournament, registration, onClose }: { tournament: OrganizerTournamentDetail; registration: Registration; onClose: () => void }) {
  const formId = useId();
  const withdraw = useWithdraw(tournament.id);
  const t = useT(messages, 'WithdrawDialog');
  const { success, error } = useToast();
  const [kind, setKind] = useState<Kind>('DISQUALIFIED');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const active = tournament.stages.find((s) => s.status === 'ACTIVE');
  const invalid = reason.trim().length < 3;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('titulo', { name: registration.displayName })}
      description={t('descricao')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('voltar')}
          </Button>
          <Button variant="danger" type="submit" form={formId} loading={withdraw.isPending}>
            {kind === 'DISQUALIFIED' ? t('desclassificar') : t('registrarDesistencia')}
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
                success(kind === 'DISQUALIFIED' ? t('desclassificado', { name: registration.displayName }) : t('desistenciaRegistrada', { name: registration.displayName }), t('atualizado'));
                onClose();
              },
              onError: (e) => error(t('erro'), errorMessage(e)),
            },
          );
        }}
      >
        <Select label={t('oQueAconteceu')} value={kind} onChange={(e) => setKind(e.target.value as Kind)} options={(Object.keys(KIND_LABEL) as Kind[]).map((value) => ({ value, label: t(KIND_LABEL[value]) }))} />
        <div className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text" data-testid="withdraw-effect">
          <p className="font-semibold">{active ? t('efeitoNaFase', { name: active.name, format: FORMAT_INFO[active.format].name }) : t('efeito')}</p>
          <p>{withdrawEffect(active, kind)}</p>
        </div>
        <Textarea label={t('motivo')} required rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint={t('motivoDica')} error={attempted && invalid ? t('motivoErro') : undefined} />
      </form>
    </Modal>
  );
}
