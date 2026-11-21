'use client';

import { Button, Modal, Textarea } from '@nova/ui';
import { useId, useState, type ReactNode } from 'react';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Rótulo do campo. Padrão: "Motivo". */
  label?: string;
  hint?: string;
  confirmLabel: string;
  danger?: boolean;
  /** Motivo obrigatório (mínimo de 3 letras). Padrão: sim. */
  required?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}

/** Confirmação com motivo: pausa, W.O., destravar chave. O motivo vai para a auditoria. */
export function ReasonDialog({ open, onOpenChange, title, description, label, hint, confirmLabel, danger = false, required = true, loading, onConfirm, children }: ReasonDialogProps) {
  const t = useT(messages, 'ReasonDialog');
  const formId = useId();
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  if (!open && (reason !== '' || attempted)) {
    setReason('');
    setAttempted(false);
  }
  const invalid = required && reason.trim().length < 3;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('voltar')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} type="submit" form={formId} loading={loading}>
            {confirmLabel}
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
          if (!invalid) onConfirm(reason.trim());
        }}
      >
        {children}
        <Textarea label={label ?? t('motivo')} required={required} rows={3} maxLength={500} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} hint={hint} error={attempted && invalid ? t('motivoErro') : undefined} />
      </form>
    </Modal>
  );
}
