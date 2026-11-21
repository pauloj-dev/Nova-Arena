'use client';

import { Button, Modal, Textarea } from '@nova/ui';
import { useState, type ReactNode } from 'react';
import { useT } from '@/shared/i18n/react';
import { adminCommonMessages } from './messages';

interface ReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Rótulo do campo de motivo. */
  reasonLabel?: string;
  reasonHint?: string;
  /** Mínimo de caracteres. Zero = motivo opcional. */
  minLength?: number;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}

/** Confirmação de ação sensível com motivo (o motivo vai para a auditoria e, quando cabe, para o usuário afetado). */
export function ReasonModal({ open, onOpenChange, title, description, reasonLabel, reasonHint, minLength = 5, confirmLabel, variant = 'primary', loading, onConfirm, children }: ReasonModalProps) {
  const t = useT(adminCommonMessages, 'ReasonModal');
  const label = reasonLabel ?? t('motivo');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  // Fechou: o texto não pode sobrar para a próxima abertura.
  if (!open && (reason !== '' || touched)) {
    setReason('');
    setTouched(false);
  }
  const trimmed = reason.trim();
  const valid = trimmed.length >= minLength;
  const error = touched && !valid ? (minLength > 0 && trimmed.length === 0 ? t('informeMotivo') : t('minimo', { min: String(minLength) })) : undefined;

  function submit() {
    setTouched(true);
    if (valid) onConfirm(trimmed);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && loading) return;
        onOpenChange(next);
      }}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('voltar')}
          </Button>
          <Button variant={variant} loading={loading} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        <Textarea
          label={minLength > 0 ? label : t('opcional', { rotulo: label })}
          hint={reasonHint}
          required={minLength > 0}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          error={error}
          maxLength={500}
          rows={3}
        />
      </div>
    </Modal>
  );
}
